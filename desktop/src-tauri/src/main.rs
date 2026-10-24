// No console window on Windows in release builds; debug builds keep it for their logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The desktop app: one window showing the server's management UI. The server
//! itself is the Node executable bundled as a sidecar; this only starts it,
//! points the window at it, and stops it again when the app quits. At start it
//! also offers to install a newer release from GitHub.

use std::collections::VecDeque;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::{Update, UpdaterExt};

/// The server prints this, followed by the URL, once the management UI is listening (server/src/index.ts).
const UI_LINE_PREFIX: &str = "Management UI: ";
/// How many of the server's last output lines to show if it stops.
const RECENT_LINES: usize = 30;
/// Where `npm run dev:desktop` serves the management UI: Vite, with reload.
const DEV_UI_URL: &str = "http://localhost:5173/manage.html";

/// Replaces whatever page the window shows with the reason the server stopped.
/// __REASON__ and __OUTPUT__ become JSON strings.
const SERVER_STOPPED_SCRIPT: &str = r#"(() => {
  document.title = "Draft Simulator";
  document.documentElement.style.cssText = "color-scheme: dark; background: #16171d";
  document.body.style.cssText = "margin: 0; padding: 2rem; color: #9ca3af; font: 16px/1.5 system-ui, sans-serif";
  document.body.innerHTML =
    '<h1 style="color: #f3f4f6; font-weight: 500; font-size: 1.5rem; margin: 0 0 0.5rem">Draft Simulator stopped</h1>' +
    '<p id="reason"></p>' +
    "<p>Close this window and start Draft Simulator again. If it keeps stopping, the output below says why.</p>" +
    '<pre style="white-space: pre-wrap; background: #1d1f27; border: 1px solid #2e303a; border-radius: 6px; ' +
    'padding: 0.75rem; font-size: 0.8rem; color: #f3f4f6"></pre>';
  document.getElementById("reason").textContent = __REASON__;
  document.querySelector("pre").textContent = __OUTPUT__;
})()"#;

struct ServerProcess(Mutex<Option<CommandChild>>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerProcess(Mutex::new(None)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                // `npm run dev:desktop` runs the server itself, with reload.
                create_window(app.handle(), WebviewUrl::External(DEV_UI_URL.parse()?))?;
            } else {
                let window = create_window(app.handle(), WebviewUrl::App("index.html".into()))?;
                start_server(app.handle(), window)?;
                // Only in release builds: a dev build has no release to compare
                // against, and installing one would replace the dev setup.
                tauri::async_runtime::spawn(offer_update(app.handle().clone()));
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while starting Draft Simulator")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                stop_server(app);
            }
        });
}

fn create_window(app: &AppHandle, url: WebviewUrl) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, "main", url)
        .title("Draft Simulator")
        .inner_size(1200.0, 900.0)
        .min_inner_size(420.0, 500.0)
        .theme(Some(tauri::Theme::Dark))
        .build()
}

fn start_server(app: &AppHandle, window: WebviewWindow) -> Result<(), Box<dyn std::error::Error>> {
    // An installed app can't keep its data next to its own binary (a macOS .app
    // is signed and may be read-only), so the server keeps its data dir and .env
    // in the per-user app data folder instead.
    let home = app.path().app_data_dir()?;
    std::fs::create_dir_all(&home)?;

    let (mut events, child) = app
        .shell()
        .sidecar("draft-simulator-server")?
        .env("DRAFT_SIMULATOR_HOME", &home)
        // Makes the server exit when this app goes away without stopping it.
        .env("DRAFT_SIMULATOR_MANAGED", "1")
        // Any free port: the server prints the URL it got, so a second copy of
        // the app or another program on 4001 can't keep the window blank.
        .env("MANAGEMENT_PORT", "0")
        .spawn()?;
    app.state::<ServerProcess>().0.lock().unwrap().replace(child);

    tauri::async_runtime::spawn(async move {
        // Read to the end even after the UI is up: an unread pipe fills up and
        // then blocks the server whenever it logs.
        let mut recent = VecDeque::with_capacity(RECENT_LINES);
        let mut showing_ui = false;
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) | CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    if !showing_ui {
                        if let Some(url) = line.strip_prefix(UI_LINE_PREFIX).and_then(|url| url.parse::<Url>().ok()) {
                            match window.navigate(url) {
                                Ok(()) => showing_ui = true,
                                Err(err) => remember(&mut recent, format!("Couldn't open the management UI: {err}")),
                            }
                        }
                    }
                    remember(&mut recent, line);
                }
                CommandEvent::Error(message) => remember(&mut recent, message),
                CommandEvent::Terminated(payload) => {
                    show_server_stopped(&window, payload.code, &recent);
                    break;
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn remember(recent: &mut VecDeque<String>, line: String) {
    if recent.len() == RECENT_LINES {
        recent.pop_front();
    }
    recent.push_back(line);
}

fn show_server_stopped(window: &WebviewWindow, code: Option<i32>, recent: &VecDeque<String>) {
    let reason = match code {
        Some(code) => format!("The server stopped unexpectedly (exit code {code})."),
        None => "The server was stopped unexpectedly.".to_string(),
    };
    let output = recent.iter().map(String::as_str).collect::<Vec<_>>().join("\n");
    let script = SERVER_STOPPED_SCRIPT
        .replace("__REASON__", &serde_json::Value::from(reason).to_string())
        .replace("__OUTPUT__", &serde_json::Value::from(output).to_string());
    // Fails only when the window is already closing because the app is
    // quitting, and then there's nobody left to tell.
    let _ = window.eval(&script);
}

/// Asks the host whether to install a newer release, if GitHub has one, and
/// installs it on yes. Never asks again until the next start, so the dialog
/// can't interrupt a draft that's under way.
async fn offer_update(app: AppHandle) {
    let update = match app.updater() {
        Ok(updater) => updater.check().await,
        Err(err) => Err(err),
    };
    let update = match update {
        Ok(Some(update)) => update,
        Ok(None) => return,
        // Offline or GitHub unreachable: the app works fine without updating.
        Err(err) => {
            eprintln!("Couldn't check for updates: {err}");
            return;
        }
    };

    let message = format!(
        "Draft Simulator {} is available (you have {}).\n\n\
         Updating restarts the app, so players who are connected lose their connection \
         until it's back. A draft that's under way continues where it left off.",
        update.version, update.current_version
    );
    let wants_update = ask(
        &app,
        message,
        "Update available",
        MessageDialogButtons::OkCancelCustom("Update now".into(), "Later".into()),
        MessageDialogKind::Info,
    )
    .await;
    if wants_update {
        install_update(&app, &update).await;
    }
}

/// Returns only if the download fails, leaving the server running. Otherwise
/// the app restarts, or on Windows exits for the installer.
async fn install_update(app: &AppHandle, update: &Update) {
    // Downloaded while the server keeps running: a failed download then costs
    // the players nothing.
    let bytes = match update.download(|_, _| {}, || {}).await {
        Ok(bytes) => bytes,
        Err(err) => {
            let message = format!("Couldn't download Draft Simulator {}: {err}", update.version);
            ask(app, message, "Update failed", MessageDialogButtons::Ok, MessageDialogKind::Error).await;
            return;
        }
    };
    // Stopped before installing: on Windows the installer can't replace the
    // server's executable while it runs.
    stop_server(app);
    if let Err(err) = update.install(bytes) {
        let message = format!(
            "Couldn't install Draft Simulator {}: {err}\n\nThe app restarts on the version you have.",
            update.version
        );
        ask(app, message, "Update failed", MessageDialogButtons::Ok, MessageDialogKind::Error).await;
    }
    // Also after a failed install, so the server, already stopped, comes back
    // on the version that's still installed.
    app.restart();
}

/// Shows a dialog and waits for it to close. Returns whether the host chose the OK button.
async fn ask(
    app: &AppHandle,
    message: String,
    title: &str,
    buttons: MessageDialogButtons,
    kind: MessageDialogKind,
) -> bool {
    let dialog = app.dialog().message(message).title(title).buttons(buttons).kind(kind);
    // blocking_show must not run on the main thread, and would hold up an async worker.
    tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
        .await
        .unwrap_or(false)
}

fn stop_server(app: &AppHandle) {
    if let Some(child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
        // If this fails, the server still exits on its own: it watches its
        // stdin, which closes when this process ends.
        let _ = child.kill();
    }
}
