// Main menu — pre-game lobby for entering a name and choosing host / join.
// Returns a promise that resolves once the player has chosen.

export interface MenuChoice {
  name: string;
  mode: "host" | "join";
  roomCode?: string;
}

export function showMenu(uiRoot: HTMLElement): Promise<MenuChoice> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.style.cssText = `position:absolute; inset:0; display:flex; align-items:center; justify-content:center; background:radial-gradient(circle at 50% 30%, #1d3f31 0%, #08130e 100%); z-index:10; font: 14px/1.4 system-ui, -apple-system, sans-serif;`;
    wrap.innerHTML = `
      <style>
        .menu-card { background:rgba(15,30,24,0.85); border:1px solid rgba(159,225,203,0.18); border-radius:16px; padding:36px 40px; max-width:420px; width: 92vw; box-shadow:0 24px 64px rgba(0,0,0,0.55); color:#e1f5ee; }
        .menu-card h1 { margin:0 0 4px; font-size:28px; color:#fff; font-weight:600; }
        .menu-card .sub { color:#9fe1cb; margin:0 0 24px; font-size:13px; }
        .menu-card label { display:block; font-size:11px; text-transform:uppercase; letter-spacing:0.10em; color:#9fe1cb; margin: 16px 0 6px; }
        .menu-card input { width:100%; background:rgba(0,0,0,0.30); border:1px solid rgba(159,225,203,0.20); border-radius:8px; padding:10px 12px; color:#fff; font:14px/1.2 system-ui; }
        .menu-card input:focus { outline:none; border-color:#1d9e75; }
        .menu-card .btn-row { display:flex; gap:10px; margin-top:24px; }
        .menu-card .btn { flex:1; background:#1d9e75; color:#fff; border:none; border-radius:8px; padding:12px; font:600 14px/1 system-ui; cursor:pointer; box-shadow:0 4px 16px rgba(29,158,117,0.3); }
        .menu-card .btn:hover { background:#23b585; }
        .menu-card .btn.secondary { background:rgba(255,255,255,0.10); color:#e1f5ee; box-shadow:none; }
        .menu-card .btn.secondary:hover { background:rgba(255,255,255,0.18); }
        .menu-card .footer { font-size:11px; color:#6b8c80; margin-top:18px; text-align:center; }
        .menu-tabs { display:flex; gap:6px; margin-top:8px; }
        .menu-tab { flex:1; padding:8px; background:rgba(0,0,0,0.25); color:#9fe1cb; border:1px solid rgba(159,225,203,0.10); border-radius:8px; text-align:center; cursor:pointer; font-size:13px; }
        .menu-tab.active { background:#1d9e75; color:#fff; border-color:#1d9e75; }
      </style>
      <div class="menu-card">
        <h1>Tower Stack</h1>
        <p class="sub">Draw a card, place a block, don't be the one who topples it all.</p>

        <label for="m-name">Your name</label>
        <input id="m-name" maxlength="24" placeholder="Player" />

        <div class="menu-tabs">
          <div class="menu-tab active" data-mode="host">Host new game</div>
          <div class="menu-tab" data-mode="join">Join with code</div>
        </div>

        <div id="join-row" style="display:none;">
          <label for="m-code">Room code</label>
          <input id="m-code" maxlength="12" placeholder="e.g. KX7P4" style="text-transform:uppercase; letter-spacing:0.10em;" />
        </div>

        <div class="btn-row">
          <button class="btn" id="m-go">Host game</button>
        </div>
        <div class="footer">Built on Three.js + Rapier · Multiplayer powered by Cloudflare Workers</div>
      </div>
    `;
    uiRoot.appendChild(wrap);

    let mode: "host" | "join" = "host";
    const nameInput = wrap.querySelector<HTMLInputElement>("#m-name")!;
    const codeInput = wrap.querySelector<HTMLInputElement>("#m-code")!;
    const joinRow = wrap.querySelector<HTMLDivElement>("#join-row")!;
    const goBtn = wrap.querySelector<HTMLButtonElement>("#m-go")!;
    const tabs = wrap.querySelectorAll<HTMLDivElement>(".menu-tab");
    const storedName = localStorage.getItem("ts.playerName") ?? "";
    nameInput.value = storedName;
    nameInput.focus();

    const setMode = (m: "host" | "join") => {
      mode = m;
      tabs.forEach((t) => t.classList.toggle("active", t.dataset.mode === m));
      joinRow.style.display = m === "join" ? "block" : "none";
      goBtn.textContent = m === "host" ? "Host game" : "Join game";
    };
    tabs.forEach((t) => t.addEventListener("click", () => setMode(t.dataset.mode as "host" | "join")));

    const submit = () => {
      const name = nameInput.value.trim() || "Player";
      localStorage.setItem("ts.playerName", name);
      if (mode === "join") {
        const code = codeInput.value.trim().toUpperCase();
        if (!code) { codeInput.focus(); return; }
        wrap.remove();
        resolve({ name, mode, roomCode: code });
      } else {
        wrap.remove();
        resolve({ name, mode });
      }
    };
    goBtn.addEventListener("click", submit);
    [nameInput, codeInput].forEach((el) =>
      el.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }),
    );
  });
}
