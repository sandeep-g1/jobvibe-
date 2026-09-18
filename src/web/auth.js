// Login and signup pages. Same visual language as the app shell.
const esc = (s) => String(s ?? '').replace(/[&<>"']/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const eyeScript = `<script>
function togglePw(btn){
  var i = btn.parentNode.querySelector('input');
  if(!i) return;
  var show = i.type === 'password';
  i.type = show ? 'text' : 'password';
  btn.textContent = show ? '🙈' : '👁';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
}
</script>`;

function shell(title, inner) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} — JobVibe</title>
<style>
  *{box-sizing:border-box} body{font-family:'Segoe UI',Tahoma,sans-serif;background:#f0f2f5;color:#1a1a2e;
    margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
  .card{background:#fff;border-radius:14px;box-shadow:0 4px 24px rgba(0,0,0,.08);width:100%;max-width:380px;padding:34px 32px}
  .brand{font-weight:800;font-size:1.35rem;color:#0a66c2;letter-spacing:-.5px;margin:0 0 4px}
  .tag{color:#667085;font-size:.85rem;margin:0 0 22px}
  label{display:block;font-size:.8rem;font-weight:600;color:#475467;margin:14px 0 5px}
  input{width:100%;padding:10px 13px;border:1.5px solid #d0d5dd;border-radius:8px;font-size:.92rem}
  input:focus{outline:none;border-color:#0a66c2}
  button{width:100%;margin-top:20px;padding:11px;background:#0a66c2;color:#fff;border:0;border-radius:8px;
    font-size:.95rem;font-weight:600;cursor:pointer}
  button:hover{background:#084fa1}
  .alt{margin-top:18px;font-size:.85rem;color:#667085;text-align:center}
  .alt a{color:#0a66c2;text-decoration:none;font-weight:600}
  .err{background:#fee2e2;color:#991b1b;border:1px solid #f0b6b8;border-radius:8px;padding:9px 13px;
    font-size:.85rem;margin-bottom:8px}
  .pwwrap{position:relative}
  .pwwrap input{padding-right:44px}
  .eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:auto;margin:0;padding:6px 8px;
    background:transparent;color:#667085;font-size:1rem;line-height:1;border:0;cursor:pointer;opacity:.7}
  .eye:hover{background:transparent;opacity:1}
</style></head><body><div class="card">
  <div class="brand">JobVibe</div>
  <p class="tag">A daily, de-duplicated shortlist of India jobs, scored to your resume.</p>
  ${inner}
</div></body></html>`;
}

export function loginPage({ error, email, noAccount } = {}) {
  const signupHref = `/signup${email ? `?email=${encodeURIComponent(email)}` : ''}`;
  return shell('Sign in', `
  ${error ? `<div class="err">${esc(error)}${noAccount
      ? ` <a href="${esc(signupHref)}" style="color:#991b1b;font-weight:700;text-decoration:underline">Create an account &rarr;</a>`
      : ''}</div>` : ''}
  <form method="POST" action="/login">
    <label>Email or username</label>
    <input type="text" name="email" value="${esc(email || '')}" autocomplete="username" autofocus required>
    <label>Password</label>
    <div class="pwwrap">
      <input type="password" name="password" id="pw" autocomplete="current-password" required>
      <button type="button" class="eye" onclick="togglePw(this)" aria-label="Show password">👁</button>
    </div>
    <button type="submit">Sign in</button>
  </form>
  <p class="alt">New here? <a href="${esc(signupHref)}">Create an account</a></p>
  ${eyeScript}`);
}

export function signupPage({ error, email, name } = {}) {
  return shell('Create account', `
  ${error ? `<div class="err">${esc(error)}</div>` : ''}
  <form method="POST" action="/signup">
    <label>Your name</label>
    <input type="text" name="name" value="${esc(name || '')}" autocomplete="name">
    <label>Email</label>
    <input type="email" name="email" value="${esc(email || '')}" autocomplete="username" required>
    <label>Password</label>
    <div class="pwwrap">
      <input type="password" name="password" id="pw" autocomplete="new-password" required
             placeholder="At least 8 characters">
      <button type="button" class="eye" onclick="togglePw(this)" aria-label="Show password">👁</button>
    </div>
    <button type="submit">Create account</button>
  </form>
  <p class="alt">Already have an account? <a href="/login">Sign in</a></p>
  ${eyeScript}`);
}
