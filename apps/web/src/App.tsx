// 앱 틀: 머리줄, 왼쪽 사이드바(900px 아래에서는 서랍), 화면. DESIGN 11절.

import { useEffect, useState } from "react";
import { Link, useRoute } from "./app/router.tsx";
import { SessionProvider, useSession } from "./app/session.tsx";
import { TabsProvider, useTabs } from "./app/tabs.tsx";
import { GuideButton } from "./components/Guide.tsx";
import { Sidebar } from "./components/Sidebar.tsx";
import { TabBar } from "./components/TabBar.tsx";
import { ToastProvider } from "./components/Toast.tsx";
import { LoginPage, SettingsPage, SignupPage, UserPage } from "./pages/AccountPages.tsx";
import { ExplorePage } from "./pages/ExplorePage.tsx";
import { FoldersPage } from "./pages/FoldersPage.tsx";
import { WildcardPage } from "./pages/WildcardPage.tsx";

export function App() {
  return (
    <ToastProvider>
      <SessionProvider>
        <TabsProvider>
          <Shell />
        </TabsProvider>
      </SessionProvider>
    </ToastProvider>
  );
}

function Shell() {
  const route = useRoute();
  const { user } = useSession();
  const [drawer, setDrawer] = useState(false);
  // 화면이 바뀌면 서랍을 닫는다. route는 그릴 때마다 새 객체라 문자열로 비교한다
  const routeKey = JSON.stringify(route);
  useEffect(() => setDrawer(false), [routeKey]);

  let page;
  switch (route.name) {
    case "explore":
      page = <ExplorePage />;
      break;
    case "wildcard":
    case "new":
      page = null; // 탭 작업공간이 그린다
      break;
    case "user":
      page = <UserPage username={route.username} />;
      break;
    case "login":
      page = <LoginPage />;
      break;
    case "signup":
      page = <SignupPage />;
      break;
    case "settings":
      page = <SettingsPage />;
      break;
    case "folders":
      page = <FoldersPage view={route.folder} />;
      break;
    default:
      page = <p className="page-pad">페이지를 찾을 수 없습니다.</p>;
  }

  return (
    <div className="app">
      <header className="app-header">
        <button type="button" className="btn btn-ghost btn-sm drawer-toggle" aria-expanded={drawer} aria-controls="sidebar" onClick={() => setDrawer(!drawer)}>
          ☰ 메뉴
        </button>
        <Link to={{ name: "explore" }} className="app-logo">
          와카아카
        </Link>
        <nav className="app-nav" aria-label="계정">
          <GuideButton />
          {user === undefined ? null : user === null ? (
            <>
              <Link to={{ name: "login" }} className="btn btn-ghost btn-sm">
                로그인
              </Link>
              <Link to={{ name: "signup" }} className="btn btn-sm">
                가입
              </Link>
            </>
          ) : (
            <>
              <Link to={{ name: "user", username: user }} className="btn btn-ghost btn-sm">
                {user}
              </Link>
              <Link to={{ name: "settings" }} className="btn btn-ghost btn-sm">
                설정
              </Link>
            </>
          )}
        </nav>
      </header>
      <div className={"app-body" + (drawer ? " drawer-open" : "")}>
        <aside id="sidebar" className="app-sidebar">
          <Sidebar onNavigate={() => setDrawer(false)} />
        </aside>
        {drawer && <div className="drawer-scrim" onClick={() => setDrawer(false)} aria-hidden="true" />}
        <div className="app-main">
          <TabBar />
          <TabWorkspace />
          {page}
        </div>
      </div>
    </div>
  );
}

/** 열린 탭의 화면. 한 번 띄운 탭은 숨겨 둘 뿐 지우지 않아서 저장 안 한 내용이 남는다(DESIGN 11절 "탭") */
function TabWorkspace() {
  const { keys, active, mounted } = useTabs();
  return (
    <>
      {keys
        .filter((k) => mounted.has(k))
        .map((k) => (
          <div key={k} className="tab-pane" hidden={k !== active}>
            <WildcardPage id={k === "new" ? null : k.slice(2)} tabKey={k} active={k === active} />
          </div>
        ))}
    </>
  );
}
