import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Dashboard from './Dashboard';
import ControlPage from './ControlPage';
import AppLayout from './AppLayout';

export default function App() {
  const [controlValues, setControlValues] = useState({
    tank: 41,
    pumping: true,
    flowRate: 2.4,
    temperature: 35,
    humidity: 65,
    f1Moisture: 62.4,
    f1Ph: 6.81,
    f1Wl: 21.3,
    f1N: 42,
    f1P: 35,
    f1K: 55,
    f1Irrigation: true,
    f1Drain: true,
    f1Acid: true,
    f1Base: false,
    f2Moisture: 60.8,
    f2Ph: 8.1,
    f2Wl: 13.3,
    f2N: 38,
    f2P: 28,
    f2K: 48,
    f2Irrigation: false,
    f2Drain: false,
    f2Acid: false,
    f2Base: false,
    f3Moisture: 24,
    f3Ph: 3.2,
    f3Wl: 8.5,
    f3N: 22,
    f3P: 18,
    f3K: 31,
    f3Irrigation: true,
    f3Drain: false,
    f3Acid: false,
    f3Base: true,
  });

  return (
    <Router>
      <Routes>
        <Route element={<AppLayout />}>
          <Route path="/" element={<Dashboard controlValues={controlValues} />} />
          <Route
            path="/controls"
            element={
              <ControlPage
                controlValues={controlValues}
                setControlValues={setControlValues}
              />
            }
          />
        </Route>
      </Routes>
    </Router>
  );
}
