import { useState } from "react";

interface LobbyPasswordScreenProps {
  error: string | null;
  onSubmit: (password: string) => void;
}

export function LobbyPasswordScreen({ error, onSubmit }: LobbyPasswordScreenProps) {
  const [password, setPassword] = useState("");

  return (
    <div className="screen">
      <h1>Draft Simulator</h1>
      <p className="subtitle">This server requires a password to connect.</p>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit(password);
        }}
      >
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoFocus />
        </label>
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={!password}>
          Connect
        </button>
      </form>
    </div>
  );
}
