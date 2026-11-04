// 계정 화면 (DESIGN 11절): 로그인, 가입(찾기 기능이 없음을 분명히), 설정(비밀번호 변경과 로그아웃만), 사용자별 목록.

import { useEffect, useState, type FormEvent } from "react";
import { invalidate, primeMeta } from "../app/cache.ts";
import { Link, navigate } from "../app/router.tsx";
import { useSession } from "../app/session.tsx";
import { api, ApiError, type Card } from "../lib/api.ts";
import { CardGrid } from "./ExplorePage.tsx";

function messageOf(e: unknown): string {
  if (!(e instanceof ApiError)) return String(e);
  switch (e.code) {
    case "E_LOGIN":
      return "아이디 또는 비밀번호가 틀렸습니다.";
    case "E_USERNAME":
      return "아이디는 영문·숫자·_·- 3~32자입니다.";
    case "E_USERNAME_TAKEN":
      return "이미 쓰는 아이디입니다.";
    case "E_PASSWORD":
      return "비밀번호는 8~256자입니다.";
    case "E_PASSWORD_WRONG":
      return "현재 비밀번호가 틀렸습니다.";
    default:
      return e.message;
  }
}

export function LoginPage() {
  const { setUser } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.login(username, password);
      invalidate();
      setUser(r.username);
      navigate({ name: "explore" });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page page-narrow">
      <h1 className="page-title">로그인</h1>
      <form className="panel form" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="u">
            아이디
          </label>
          <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="p">
            비밀번호
          </label>
          <input id="p" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && (
          <p className="text-danger" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-block" disabled={busy}>
          로그인
        </button>
        <p className="text-muted">
          계정이 없으면 <Link to={{ name: "signup" }}>가입</Link>
        </p>
      </form>
    </div>
  );
}

export function SignupPage() {
  const { setUser } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== password2) return setError("비밀번호 확인이 다릅니다.");
    setBusy(true);
    setError(null);
    try {
      const r = await api.signup(username, password);
      invalidate();
      setUser(r.username);
      navigate({ name: "explore" });
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page page-narrow">
      <h1 className="page-title">가입</h1>
      <div className="banner banner-warning" role="note">
        <strong>아이디·비밀번호 찾기 기능이 없습니다.</strong> 이메일을 받지 않으므로, 비밀번호를 잊으면 계정과 그 와일드카드를 되찾을 방법이 없습니다. 비밀번호를 따로 적어 두세요.
      </div>
      <form className="panel form" onSubmit={submit}>
        <div className="field">
          <label className="label" htmlFor="u">
            아이디 <span className="text-muted">영문·숫자·_·- 3~32자, 대소문자 구분 없이 하나</span>
          </label>
          <input id="u" className="input" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} pattern="[A-Za-z0-9_\-]{3,32}" required />
        </div>
        <div className="field">
          <label className="label" htmlFor="p">
            비밀번호 <span className="text-muted">8자 이상</span>
          </label>
          <input id="p" className="input" type="password" autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="p2">
            비밀번호 확인
          </label>
          <input id="p2" className="input" type="password" autoComplete="new-password" value={password2} onChange={(e) => setPassword2(e.target.value)} required />
        </div>
        <label className="label">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          찾기 기능이 없다는 것을 이해했습니다. 모든 와일드카드는 공개됩니다.
        </label>
        {error && (
          <p className="text-danger" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-block" disabled={busy || !agree}>
          가입
        </button>
      </form>
    </div>
  );
}

export function SettingsPage() {
  const { user, setUser } = useSession();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (user === null) {
    return (
      <p className="page-pad">
        <Link to={{ name: "login" }}>로그인</Link>하세요.
      </p>
    );
  }
  const change = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== next2) return setMsg({ ok: false, text: "새 비밀번호 확인이 다릅니다." });
    try {
      await api.changePassword(current, next);
      setCurrent("");
      setNext("");
      setNext2("");
      setMsg({ ok: true, text: "비밀번호를 바꿨습니다. 다른 기기의 로그인은 모두 풀렸습니다." });
    } catch (err) {
      setMsg({ ok: false, text: messageOf(err) });
    }
  };
  const logout = async () => {
    await api.logout().catch(() => {});
    invalidate();
    setUser(null);
    navigate({ name: "explore" });
  };
  return (
    <div className="page page-narrow">
      <h1 className="page-title">설정</h1>
      <form className="panel form" onSubmit={change}>
        <h2 className="panel-title">비밀번호 변경</h2>
        <div className="field">
          <label className="label" htmlFor="c">
            현재 비밀번호
          </label>
          <input id="c" className="input" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="n">
            새 비밀번호 <span className="text-muted">8자 이상</span>
          </label>
          <input id="n" className="input" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </div>
        <div className="field">
          <label className="label" htmlFor="n2">
            새 비밀번호 확인
          </label>
          <input id="n2" className="input" type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} required />
        </div>
        {msg && (
          <p className={msg.ok ? "text-success" : "text-danger"} role="status">
            {msg.text}
          </p>
        )}
        <button className="btn">바꾸기</button>
      </form>
      <div className="panel form">
        <h2 className="panel-title">로그아웃</h2>
        <button type="button" className="btn btn-secondary" onClick={() => void logout()}>
          로그아웃 ({user})
        </button>
      </div>
    </div>
  );
}

export function UserPage({ username }: { username: string }) {
  const [data, setData] = useState<{ user: string; cards: Card[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setData(null);
    setError(null);
    api
      .user(username)
      .then((r) => {
        if (!live) return;
        primeMeta(r.wildcards);
        setData({ user: r.user.username, cards: r.wildcards });
      })
      .catch((e) => live && setError(e instanceof ApiError && e.status === 404 ? "없는 사용자입니다" : String(e)));
    return () => {
      live = false;
    };
  }, [username]);
  if (error) return <p className="page-pad text-danger">{error}</p>;
  if (!data) return <p className="page-pad text-muted">불러오는 중…</p>;
  return (
    <div className="page">
      <h1 className="page-title">{data.user}의 와일드카드</h1>
      {data.cards.length === 0 ? <p className="text-muted">아직 없습니다</p> : <CardGrid cards={data.cards} showOrigin />}
    </div>
  );
}
