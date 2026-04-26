import React, { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router-dom';

const AppLayout = () => {
  const location = useLocation();
  const isFullWidthPage = location.pathname === '/';
  const contentWrapperClass = `content-wrapper${isFullWidthPage ? ' dashboard-wrapper' : ''}`;
  const viewportClass = `app-viewport${isFullWidthPage ? ' dashboard-page' : ''}`;

  useEffect(() => {
    const preventDefault = (event) => event.preventDefault();

    document.addEventListener('contextmenu', preventDefault);
    document.addEventListener('selectstart', preventDefault);
    document.addEventListener('dragstart', preventDefault);

    return () => {
      document.removeEventListener('contextmenu', preventDefault);
      document.removeEventListener('selectstart', preventDefault);
      document.removeEventListener('dragstart', preventDefault);
    };
  }, []);

  return (
    <div className={viewportClass}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }

        html, body, #root {
          width: 100%;
          min-height: 100%;
          background: #ffffff;
        }

        body {
          margin: 0;
        }

        .app-viewport {
          display: flex;
          flex-direction: column;
          align-items: center;
          width: 100%;
          height: 100vh;
          min-height: 100vh;
          background: #ffffff;
          padding: 18px 20px 24px;
          overflow-x: hidden;
        }

        .content-wrapper {
          width: min(1180px, 100%);
          margin: 0 auto;
        }

        .content-wrapper.dashboard-wrapper {
          width: 100%;
          max-width: none;
          min-height: calc(100vh - 42px);
          overflow: visible;
        }

        @media screen and (max-height: 820px) {
          .app-viewport {
            padding-top: 12px;
            padding-bottom: 14px;
          }
        }

        .app-viewport.dashboard-page {
          overflow-x: hidden;
          overflow-y: hidden;
          height: 100vh;
          min-height: 100vh;
          padding: 0;
        }

        .app-viewport.dashboard-page .content-wrapper.dashboard-wrapper {
          height: 100%;
          min-height: 100%;
          display: flex;
          flex-direction: column;
        }

        .page-content {
          width: 100%;
        }

        .page-content.full-page {
          flex: 1;
          min-height: 0;
          display: flex;
          width: 100%;
          overflow: hidden;
        }

      `}</style>

      <div className={contentWrapperClass}>
        <div className={`page-content${isFullWidthPage ? ' full-page' : ''}`}>
          <Outlet />
        </div>
      </div>
    </div>
  );
};

export default AppLayout;
