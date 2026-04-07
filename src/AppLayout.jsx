import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';

const AppLayout = () => {
  const location = useLocation();
  const isFullWidthPage = location.pathname === '/' || location.pathname === '/controls';
  const contentWrapperClass = `content-wrapper${isFullWidthPage ? ' dashboard-wrapper' : ''}`;
  const viewportClass = `app-viewport${isFullWidthPage ? ' dashboard-page' : ''}`;

  const getBtnStyle = (path) => ({
    background: location.pathname === path ? 'white' : 'rgba(255, 255, 255, 0.15)',
    color: location.pathname === path ? '#0d9488' : 'white',
  });

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

        .nav-header {
          background: #0d9488;
          color: white;
          padding: 11px 18px;
          border-radius: 12px;
          margin-bottom: 12px;
          display: flex;
          align-items: center;
          gap: 14px;
          font-size: 14px;
          box-shadow: 0 2px 8px rgba(13,148,136,0.18);
        }

        .brand {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 700;
          flex-shrink: 0;
        }

        .nav-actions {
          display: flex;
          gap: 10px;
          margin-left: 8px;
        }

        .nav-link-btn {
          text-decoration: none;
          border: none;
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.2s ease;
        }

        .nav-link-btn:hover {
          background: rgba(255, 255, 255, 0.3) !important;
        }

        .nav-note {
          margin-left: auto;
          font-size: 10px;
          opacity: 0.8;
          white-space: nowrap;
        }

        @media screen and (max-width: 900px) {
          .app-viewport {
            padding: 16px;
          }

          .nav-header {
            flex-wrap: wrap;
          }

          .nav-actions {
            margin-left: 0;
          }

          .nav-note {
            margin-left: 0;
            width: 100%;
          }
        }

        @media screen and (max-height: 820px) {
          .app-viewport {
            padding-top: 12px;
            padding-bottom: 14px;
          }

          .nav-header {
            margin-bottom: 10px;
          }
        }

        .app-viewport.dashboard-page {
          overflow-x: hidden;
          overflow-y: hidden;
          padding-left: 0;
          padding-right: 0;
        }

        .app-viewport.dashboard-page .nav-header {
          margin-bottom: 8px;
        }

        @media screen and (max-width: 640px) {
          .nav-header {
            align-items: flex-start;
          }

          .nav-actions {
            width: 100%;
            flex-wrap: wrap;
          }
        }
      `}</style>

      <div className={contentWrapperClass}>
        <div className="nav-header">
          <div className="brand">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
            AGRI-IOT PRO
          </div>

          <div className="nav-actions">
            <Link to="/" className="nav-link-btn" style={getBtnStyle('/')}>
              Dashboard
            </Link>
            <Link to="/controls" className="nav-link-btn" style={getBtnStyle('/controls')}>
              System Controls
            </Link>
          </div>

          <span className="nav-note"></span>
        </div>

        <Outlet />
      </div>
    </div>
  );
};

export default AppLayout;
