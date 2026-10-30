// No console window on Windows in release builds; debug builds keep it for their logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

//! The desktop app: one window showing the server's management UI. The server
//! itself is the Node executable bundled as a sidecar; this only starts it,
//! points the window at it, and stops it again when the app quits. Before
//! starting the server, the window offers to install a newer release from GitHub.

use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Duration;

use tauri::webview::PageLoadEvent;
use tauri::{AppHandle, Manager, RunEvent, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tauri_plugin_updater::{Update, UpdaterExt};

/// The server prints this, followed by the URL, once the management UI is listening (server/src/index.ts).
const UI_LINE_PREFIX: &str = "Management UI: ";
/// How many of the server's last output lines to show if it stops.
const RECENT_LINES: usize = 30;
/// Where `npm run dev:desktop` serves the management UI: Vite, with reload.
const DEV_UI_URL: &str = "http://localhost:5173/manage.html";
/// How long the start page waits for the update check before starting the
/// server without it, so a slow network can't keep the host from drafting.
const UPDATE_CHECK_TIMEOUT: Duration = Duration::from_secs(10);
/// The start page's buttons go to addresses on this host, which never resolves
/// (.invalid). The window catches them and does what the button says instead:
/// the page itself can't call Rust.
const CHOICE_HOST: &str = "draft-simulator.invalid";

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

/// What the start page shows, so its buttons work only while it shows them.
enum Startup {
    /// The start page hasn't finished loading.
    Loading,
    /// Checking for an update, downloading it or starting the server: no buttons.
    Busy,
    Offering(Box<Update>),
    /// Downloading or installing the update failed; Continue starts the server.
    Failed { message: String },
}

struct StartupState(Mutex<Startup>);

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(ServerProcess(Mutex::new(None)))
        .manage(StartupState(Mutex::new(Startup::Loading)))
        .setup(|app| {
            if cfg!(debug_assertions) {
                // `npm run dev:desktop` runs the server itself, with reload.
                window_builder(app.handle(), WebviewUrl::External(DEV_UI_URL.parse()?)).build()?;
            } else {
                // Only release builds check for updates: a dev build has no
                // release to compare against, and installing one would replace
                // the dev setup.
                create_start_window(app.handle())?;
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

fn window_builder(app: &AppHandle, url: WebviewUrl) -> WebviewWindowBuilder<'_, Wry, AppHandle> {
    // The product name, so a beta's window says "Draft Simulator Beta".
    WebviewWindowBuilder::new(app, "main", url)
        .title(&app.package_info().name)
        .inner_size(1200.0, 900.0)
        .min_inner_size(420.0, 500.0)
        .theme(Some(tauri::Theme::Dark))
}

/// Opens the window on the start page, which checks for an update before the
/// server starts and then gives way to the management UI.
fn create_start_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let navigating_app = app.clone();
    let loading_app = app.clone();
    window_builder(app, WebviewUrl::App("index.html".into()))
        .on_navigation(move |url| {
            if url.host_str() != Some(CHOICE_HOST) {
                return true;
            }
            // Not inside the navigation callback: it can run on the main
            // thread while the webview waits for its answer.
            let app = navigating_app.clone();
            let choice = url.path().to_string();
            tauri::async_runtime::spawn(async move { choose(&app, &choice) });
            false
        })
        .on_page_load(move |_, payload| {
            if payload.event() == PageLoadEvent::Finished {
                start_page_loaded(&loading_app);
            }
        })
        .build()
}

/// The first time, starts the update check, now that the page's functions
/// exist. After a reload, shows the buttons again, which the reload hid.
fn start_page_loaded(app: &AppHandle) {
    let state = app.state::<StartupState>();
    let mut startup = state.0.lock().unwrap();
    match &*startup {
        Startup::Loading => {
            *startup = Startup::Busy;
            tauri::async_runtime::spawn(check_for_update(app.clone()));
        }
        Startup::Offering(update) => show_offer(app, update),
        Startup::Failed { message } => show_choice(app, message, None, "Continue"),
        // Also the management UI, which loads once the server has started.
        Startup::Busy => {}
    }
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

/// Starts the server, unless GitHub has a newer release: then the start page
/// asks the host first. Never asks again until the next start, so the question
/// can't interrupt a draft that's under way.
async fn check_for_update(app: AppHandle) {
    let update = match app.updater_builder().timeout(UPDATE_CHECK_TIMEOUT).build() {
        Ok(updater) => updater.check().await,
        Err(err) => Err(err),
    };
    match update {
        Ok(Some(update)) => {
            show_offer(&app, &update);
            set_startup(&app, Startup::Offering(Box::new(update)));
        }
        Ok(None) => begin_server(&app),
        // Offline, or GitHub unreachable or too slow: the app works fine without updating.
        Err(err) => {
            eprintln!("Couldn't check for updates: {err}");
            begin_server(&app);
        }
    }
}

/// Does what the start page button the host clicked says (its address's path).
/// Does nothing if the page isn't showing that button: a second click, or
/// another page going to the same address.
fn choose(app: &AppHandle, choice: &str) {
    let startup = std::mem::replace(&mut *app.state::<StartupState>().0.lock().unwrap(), Startup::Busy);
    match (choice, startup) {
        ("/update-now", Startup::Offering(update)) => {
            tauri::async_runtime::spawn(install_update(app.clone(), *update));
        }
        ("/continue", Startup::Offering(_) | Startup::Failed { .. }) => begin_server(app),
        (_, startup) => set_startup(app, startup),
    }
}

/// Returns only if the download or install fails, after the start page offers
/// to continue without it. Otherwise the app restarts, or on Windows exits for
/// the installer.
async fn install_update(app: AppHandle, update: Update) {
    let downloading = format!("Downloading Draft Simulator {}…", update.version);
    show_status(&app, &downloading);
    let mut received: u64 = 0;
    let mut shown_percent = None;
    let download = update.download(
        |chunk, total| {
            received += chunk as u64;
            // Without a size from GitHub, the page just says it's downloading.
            if let Some(total) = total.filter(|&total| total > 0) {
                let percent = (received * 100 / total).min(100);
                if shown_percent != Some(percent) {
                    shown_percent = Some(percent);
                    show_status(&app, &format!("{downloading} {percent}%"));
                }
            }
        },
        || {},
    );
    let bytes = match download.await {
        Ok(bytes) => bytes,
        Err(err) => {
            update_failed(&app, format!("Couldn't download Draft Simulator {}: {err}", update.version));
            return;
        }
    };
    // On Windows the installer can't replace the server's executable while it
    // runs. The server starts only after the host has chosen, so it isn't
    // running yet; this keeps that true if the order ever changes.
    stop_server(&app);
    show_status(&app, &format!("Installing Draft Simulator {}…", update.version));
    if let Err(err) = update.install(bytes) {
        // No restart needed: the server hasn't started yet, and the updater
        // puts the installed version back when replacing it fails.
        update_failed(&app, format!("Couldn't install Draft Simulator {}: {err}", update.version));
        return;
    }
    app.restart();
}

fn update_failed(app: &AppHandle, message: String) {
    eprintln!("{message}");
    show_choice(app, &message, None, "Continue");
    set_startup(app, Startup::Failed { message });
}

/// Shows "Starting…" and starts the server, whose output then opens the
/// management UI in the window.
fn begin_server(app: &AppHandle) {
    // Gone only when the app is quitting.
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    show_status(app, "Starting…");
    if let Err(err) = start_server(app, window) {
        show_status(app, &format!("Couldn't start the server: {err}"));
    }
}

fn set_startup(app: &AppHandle, startup: Startup) {
    *app.state::<StartupState>().0.lock().unwrap() = startup;
}

fn show_offer(app: &AppHandle, update: &Update) {
    let message = format!(
        "Draft Simulator {} is available (you have {}). Updating restarts the app.",
        update.version, update.current_version
    );
    show_choice(app, &message, Some("Update now"), "Later");
}

fn show_status(app: &AppHandle, text: &str) {
    call_start_page(app, "showStatus", &[text.into()]);
}

/// Without `update_label`, only the continue button shows.
fn show_choice(app: &AppHandle, text: &str, update_label: Option<&str>, continue_label: &str) {
    call_start_page(app, "showChoice", &[text.into(), update_label.into(), continue_label.into()]);
}

/// Calls one of the start page's functions (splash/index.html), with each argument as JSON.
fn call_start_page(app: &AppHandle, function: &str, args: &[serde_json::Value]) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let args = args.iter().map(ToString::to_string).collect::<Vec<_>>().join(", ");
    // Fails only when the window is already closing because the app is
    // quitting, and then there's nobody left to tell.
    let _ = window.eval(format!("{function}({args})"));
}

fn stop_server(app: &AppHandle) {
    if let Some(child) = app.state::<ServerProcess>().0.lock().unwrap().take() {
        // If this fails, the server still exits on its own: it watches its
        // stdin, which closes when this process ends.
        let _ = child.kill();
    }
}
