import React, { useState, useEffect, useRef } from 'react';

const AgricultureDashboard = ({ controlValues = {} }) => {
  const BASE_DASHBOARD_WIDTH = 1360;
  // --- INITIAL STATE (Unchanged) ---
  const [state, setState] = useState({
    tank: 41,
    pumping: true,
    flowRate: 2.4,
    gh: { temp: 35, humidity: 65 },
    f1: { moisture: 62.4, ph: 6.81, wl: 21.3, n: 42, p: 35, k: 55, irrigation: true, drain: true, acid: true, base: false },
    f2: { moisture: 60.8, ph: 8.10, wl: 13.3, n: 38, p: 28, k: 48, irrigation: false, drain: false, acid: false, base: false },
    f3: { moisture: 24, ph: 3.2, wl: 8.5, n: 22, p: 18, k: 31, irrigation: true, drain: false, acid: false, base: true },
    time: ''
  });

  const [isMounted, setIsMounted] = useState(false);
  const [dashboardHeight, setDashboardHeight] = useState(640);
  const shellRef = useRef(null);
  const dashRef = useRef(null);

  // --- APPLY CONTROL VALUES ---
  useEffect(() => {
    setState(prevState => ({
      ...prevState,
      tank: controlValues.tank !== undefined ? controlValues.tank : prevState.tank,
      pumping: controlValues.pumping !== undefined ? controlValues.pumping : prevState.pumping,
      flowRate: controlValues.flowRate !== undefined ? controlValues.flowRate : prevState.flowRate,
      gh: { 
        temp: controlValues.temperature !== undefined ? controlValues.temperature : prevState.gh.temp,
        humidity: controlValues.humidity !== undefined ? controlValues.humidity : prevState.gh.humidity
      },
      f1: { 
        ...prevState.f1, 
        moisture: controlValues.f1Moisture !== undefined ? controlValues.f1Moisture : prevState.f1.moisture,
        ph: controlValues.f1Ph !== undefined ? controlValues.f1Ph : prevState.f1.ph,
        wl: controlValues.f1Wl !== undefined ? controlValues.f1Wl : prevState.f1.wl,
        n: controlValues.f1N !== undefined ? controlValues.f1N : prevState.f1.n,
        p: controlValues.f1P !== undefined ? controlValues.f1P : prevState.f1.p,
        k: controlValues.f1K !== undefined ? controlValues.f1K : prevState.f1.k,
        irrigation: controlValues.f1Irrigation !== undefined ? controlValues.f1Irrigation : prevState.f1.irrigation,
        drain: controlValues.f1Drain !== undefined ? controlValues.f1Drain : prevState.f1.drain,
        acid: controlValues.f1Acid !== undefined ? controlValues.f1Acid : prevState.f1.acid,
        base: controlValues.f1Base !== undefined ? controlValues.f1Base : prevState.f1.base
      },
      f2: { 
        ...prevState.f2, 
        moisture: controlValues.f2Moisture !== undefined ? controlValues.f2Moisture : prevState.f2.moisture,
        ph: controlValues.f2Ph !== undefined ? controlValues.f2Ph : prevState.f2.ph,
        wl: controlValues.f2Wl !== undefined ? controlValues.f2Wl : prevState.f2.wl,
        n: controlValues.f2N !== undefined ? controlValues.f2N : prevState.f2.n,
        p: controlValues.f2P !== undefined ? controlValues.f2P : prevState.f2.p,
        k: controlValues.f2K !== undefined ? controlValues.f2K : prevState.f2.k,
        irrigation: controlValues.f2Irrigation !== undefined ? controlValues.f2Irrigation : prevState.f2.irrigation,
        drain: controlValues.f2Drain !== undefined ? controlValues.f2Drain : prevState.f2.drain,
        acid: controlValues.f2Acid !== undefined ? controlValues.f2Acid : prevState.f2.acid,
        base: controlValues.f2Base !== undefined ? controlValues.f2Base : prevState.f2.base
      },
      f3: { 
        ...prevState.f3, 
        moisture: controlValues.f3Moisture !== undefined ? controlValues.f3Moisture : prevState.f3.moisture,
        ph: controlValues.f3Ph !== undefined ? controlValues.f3Ph : prevState.f3.ph,
        wl: controlValues.f3Wl !== undefined ? controlValues.f3Wl : prevState.f3.wl,
        n: controlValues.f3N !== undefined ? controlValues.f3N : prevState.f3.n,
        p: controlValues.f3P !== undefined ? controlValues.f3P : prevState.f3.p,
        k: controlValues.f3K !== undefined ? controlValues.f3K : prevState.f3.k,
        irrigation: controlValues.f3Irrigation !== undefined ? controlValues.f3Irrigation : prevState.f3.irrigation,
        drain: controlValues.f3Drain !== undefined ? controlValues.f3Drain : prevState.f3.drain,
        acid: controlValues.f3Acid !== undefined ? controlValues.f3Acid : prevState.f3.acid,
        base: controlValues.f3Base !== undefined ? controlValues.f3Base : prevState.f3.base
      }
    }));
  }, [controlValues]);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // --- INITIALIZE TIME ON CLIENT SIDE AFTER HYDRATION ---
  useEffect(() => {
    setIsMounted(true);
    setState(prevState => ({ ...prevState, time: new Date().toLocaleTimeString() }));
  }, []);

  useEffect(() => {
    const updateLayout = () => {
      if (!shellRef.current || !dashRef.current) return;

      const naturalHeight = Math.max(dashRef.current.scrollHeight, 1);
      setDashboardHeight(naturalHeight);
    };

    updateLayout();
    window.addEventListener('resize', updateLayout);
    const resizeObserver = new ResizeObserver(() => updateLayout());
    resizeObserver.observe(shellRef.current);
    resizeObserver.observe(dashRef.current);

    return () => {
      window.removeEventListener('resize', updateLayout);
      resizeObserver.disconnect();
    };
  }, []);

  // --- UTILS (Unchanged) ---
  const phColor = (ph) => {
    if (ph < 4) return '#ef4444';
    if (ph < 6) return '#f97316';
    if (ph < 6.5) return '#eab308';
    if (ph <= 7.5) return '#22c55e';
    if (ph <= 9) return '#3b82f6';
    return '#8b5cf6';
  };

  const moistureColor = (m) => {
    if (m > 55) return '#22c55e';
    if (m > 35) return '#eab308';
    return '#ef4444';
  };

  // --- SIMULATION LOGIC (Unchanged) ---
  useEffect(() => {
    const interval = setInterval(() => {
      const s = JSON.parse(JSON.stringify(stateRef.current));

      if (s.pumping && s.tank < 80) {
        s.tank = Math.min(s.tank + 0.35 + Math.random() * 0.1, 80);
        s.flowRate = 2.2 + Math.random() * 0.5;
      } else if (s.tank >= 80) {
        s.pumping = false;
        s.flowRate = 0;
      } else if (s.tank < 20) {
        s.pumping = true;
      }

      ['f1', 'f2', 'f3'].forEach((id) => {
        const f = s[id];
        if (f.irrigation && f.moisture < 60) {
          f.moisture = Math.min(f.moisture + 0.25 + Math.random() * 0.15, 60);
        } else if (f.moisture >= 60) {
          f.irrigation = false;
          f.drain = true;
        } else if (f.moisture < 30) {
          f.irrigation = true;
          f.drain = false;
        }
        f.moisture = Math.max(0, Math.min(100, f.moisture + (Math.random() - 0.5) * 0.3));
        f.ph = Math.max(0, Math.min(14, f.ph + (Math.random() - 0.5) * 0.05));
        f.wl = Math.max(0, Math.min(30, f.wl + (Math.random() - 0.5) * 0.2));
      });

      s.gh.temp = Math.max(20, Math.min(60, s.gh.temp + (Math.random() - 0.47) * 0.4));
      s.gh.humidity = Math.max(30, Math.min(95, s.gh.humidity + (Math.random() - 0.5) * 0.6));
      s.time = new Date().toLocaleTimeString();

      setState(s);
    }, 1400);

    return () => clearInterval(interval);
  }, []);

  const remTime = Math.max(0, Math.round((80 - state.tank) / (state.flowRate || 1) * 25));
  const fanOn = state.gh.temp > 40 || state.gh.humidity > 70;
  const fireOn = state.gh.temp > 40;
  const fanSpeedClass = state.gh.temp > 50 ? "spin-fast" : state.gh.temp > 44 ? "spin-med" : "spin-slow";
  const greenhouseTempPct = Math.min((state.gh.temp / 60) * 100, 100);
  const greenhouseTempColor =
    state.gh.temp <= 24 ? '#3b82f6' : state.gh.temp <= 35 ? '#f59e0b' : '#ef4444';
  const mainTankScaleTicks = [
    { value: 100, position: 100, emphasis: true },
    { value: 75, position: 75 },
    { value: 50, position: 50 },
    { value: 25, position: 25 },
    { value: 0, position: 0, emphasis: true }
  ];

  const StatusChip = ({ on, label }) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '20px', fontWeight: 700, color: on ? '#16a34a' : '#94a3b8' }}>
      <span className="dot" style={{ background: on ? '#22c55e' : '#cbd5e1' }}></span>
      {label}
    </span>
  );

  const WaterScale = ({ ticks, unit, compact = false }) => (
    <div className={`water-scale ${compact ? 'compact' : ''}`}>
      {ticks.map((tick) => (
        <div
          key={tick.value}
          className={`scale-tick ${tick.emphasis ? 'emphasis' : ''} ${tick.position === 100 ? 'top-edge' : ''} ${tick.position === 0 ? 'bottom-edge' : ''}`}
          style={{ top: `${100 - tick.position}%` }}
        >
          <span className="scale-line"></span>
          <span className="scale-label">{tick.label ?? tick.value}</span>
        </div>
      ))}
      {unit ? <span className="scale-unit">{unit}</span> : null}
    </div>
  );

  const AnimatedWaterFill = ({ height, label }) => (
    <div className="water-fill" style={{ height }}>
      <div className="water-wave"></div>
      {label ? <span className="water-value">{label}</span> : null}
    </div>
  );

  const FieldCard = ({ data, title }) => {
    const mc = moistureColor(data.moisture);
    const phPct = (data.ph / 14 * 100).toFixed(1);
    const wlPct = Math.min(data.wl / 30 * 100, 100);
    const moistureAngle = -90 + (data.moisture / 100) * 180;
    const fieldScaleTicks = [
      { value: 30, position: 100, emphasis: true },
      { value: 20, position: 66.7 },
      { value: 10, position: 33.3 },
      { value: 0, position: 0, emphasis: true }
    ];

    return (
      <div className="card">
        <div className="ctitle">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/></svg>
          {title}
          <span className="dot" style={{ marginLeft: 'auto', background: data.irrigation ? '#22c55e' : '#cbd5e1' }}></span>
          <span style={{ fontSize: '20px', color: data.irrigation ? '#16a34a' : '#94a3b8' }}>{data.irrigation ? 'Irrigating' : 'Idle'}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(190px, 1.45fr) minmax(90px, 0.8fr) minmax(120px, 1fr)', columnGap: '8px', rowGap: '14px', alignItems: 'start' }}>
          <div className="col">
            <div className="moisture-gauge">
              <svg className="moisture-gauge-svg" width="164" height="112" viewBox="0 0 164 112" style={{ overflow: 'visible' }}>
                <path d="M24 72 A54 54 0 0 1 132 72" fill="none" stroke="#dbe4f0" strokeWidth="13" strokeLinecap="round" />
                <path
                  d="M24 72 A54 54 0 0 1 132 72"
                  fill="none"
                  stroke={mc}
                  strokeWidth="13"
                  strokeLinecap="round"
                  strokeDasharray={`${(data.moisture / 100) * 170} 170`}
                  className="gauge-arc"
                />
                <g style={{ transform: `rotate(${moistureAngle}deg)`, transformOrigin: '78px 72px' }}>
                  <line x1="78" y1="72" x2="78" y2="26" stroke="#64748b" strokeWidth="4" strokeLinecap="round" />
                  <circle cx="78" cy="26" r="4.5" fill="#64748b" />
                </g>
                <circle cx="78" cy="72" r="11" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
                <circle cx="78" cy="72" r="5.5" fill={mc} />
                <text x="7" y="82" fontSize="11" fontWeight="800" fill="#475569">0</text>
                <text x="74" y="10" fontSize="11" fontWeight="800" fill="#475569">50</text>
                <text x="137" y="82" fontSize="11" fontWeight="800" fill="#475569">100</text>
                <rect x="48" y="80" width="60" height="28" rx="14" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
                <text x="78" y="98" textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a">{data.moisture.toFixed(1)}%</text>
              </svg>
            </div>
            <span className="lbl">Moisture</span>
          </div>
          <div className="col">
            <div className="water-level-indicator">
              <div className="tank-meter compact water-level-indicator-inner">
                <div className="field-tank">
                  <AnimatedWaterFill height={`${wlPct}%`} />
                </div>
                <WaterScale ticks={fieldScaleTicks} compact />
              </div>
            </div>
            <div className="val">{data.wl.toFixed(1)}</div>
            <span className="lbl">Water</span>
          </div>
          <div className="col" style={{ width: '100%' }}>
            <div style={{ width: '100%', fontSize: '10px', color: '#475569', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}><span>0</span><span>7</span><span>14</span></div>
            <div className="ph-track"><div className="ph-dot" style={{ left: `${phPct}%` }}></div></div>
            <div style={{ textAlign: 'center', fontSize: '20px', fontWeight: '900', color: phColor(data.ph) }}>pH {data.ph.toFixed(2)}</div>
            <span className="lbl">pH</span>
          </div>
        </div>
        <div style={{ marginTop: '10px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {[ {l:'N', v:data.n, c:'#22c55e'}, {l:'P', v:data.p, c:'#f59e0b'}, {l:'K', v:data.k, c:'#8b5cf6'} ].map(item => (
               <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                <span style={{ color: item.c, fontSize: '20px', fontWeight: 900, width: '50px' }}>{item.l}</span>
                 <div className="npk-track"><div className="npk-fill" style={{ width: `${item.v}%`, background: item.c }}></div></div>
                 <span style={{ color: '#334155', fontSize: '17px', fontWeight: 700, width: '36px', textAlign: 'right', lineHeight: 1 }}>{item.v}</span>
               </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: '10px', paddingTop: '9px', borderTop: '0.5px solid #f1f5f9', display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <StatusChip on={data.irrigation} label="Irrigation" />
          <StatusChip on={data.drain} label="Drain" />
          <StatusChip on={data.acid} label="Acid" />
          <StatusChip on={data.base} label="Base" />
        </div>
      </div>
    );
  };

  return (
    <div className="dash-container" ref={shellRef}>
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
        
        body, html, #root { 
          height: 100%; 
          width: 100%; 
          background: #ffffff; 
        }

        .dash-container { 
          display: flex;
          justify-content: center;
          align-items: flex-start;
          width: 100%;
          height: 100%;
          min-height: 100%;
          padding: 0;
          margin: 0;
          background: #ffffff;
          overflow: hidden;
        }

        .dash-frame {
          display: flex;
          justify-content: center;
          align-items: flex-start;
          width: 100%;
          height: 100%;
          padding: 0;
          margin: 0;
          overflow: hidden;
        }

        .dash {
          width: 100%;
          min-width: 0;
          max-width: 100%;
          margin: 0;
        }

        .header { 
          background: #0d9488; 
          color: white; 
          padding: 11px 18px; 
          border-radius: 12px; 
          margin-bottom: 12px; 
          display: flex; 
          align-items: center; 
          gap: 15px; 
          font-size: 20px; 
          font-weight: 500; 
          box-shadow: 0 2px 8px rgba(13,148,136,0.18); 
        }

        .nav-link {
          background: rgba(255, 255, 255, 0.15);
          color: white;
          border: none;
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 600;
          transition: all 0.2s ease;
          text-decoration: none;
        }

        .nav-link:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .quad-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          grid-template-rows: repeat(2, minmax(0, 1fr));
          gap: 18px;
          min-height: 640px;
          width: 100%;
        }
        .quad-section {
          min-height: 0;
        }
        .overview-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
          gap: 18px;
          height: 100%;
          align-items: stretch;
          width: 100%;
        }
        .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; box-shadow: 0 2px 10px rgba(0,0,0,0.07); min-height: 276px; height: 100%; min-width: 0; }
        .ctitle { font-size: 22px; font-weight: 700; color: #0d9488; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .lbl { font-size: 20px; font-weight: 900; color: #94a3b8; text-align: center; margin-top: 4px; }
        .val { font-size: 17px; font-weight: 700; color: #1e293b; text-align: center; line-height: 1.2; }
        .col { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
        .row { display: flex; align-items: center; gap: 9px; }
        .badge { font-size: 12px; padding: 3px 10px; border-radius: 20px; font-weight: 600; display: inline-block; }
        .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .stat-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; padding: 7px 0; border-bottom: 0.5px solid #f1f5f9; }
        
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes flow { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        @keyframes blink { 50% { opacity: 0.15; } }
        @keyframes waterWave {
          0% { transform: translateX(-24%) translateY(0); }
          50% { transform: translateX(-16%) translateY(2px); }
          100% { transform: translateX(-24%) translateY(0); }
        }
        
        .spin-slow { animation: spin 2.5s linear infinite; }
        .spin-med { animation: spin 1s linear infinite; }
        .spin-fast { animation: spin 0.35s linear infinite; }
        .spin-stop { }

        .pipe { position: relative; overflow: hidden; border-radius: 3px; background: #bae6fd; height: 6px; width: 28px; }
        .pipe-flow { position: absolute; top: 0; left: 0; width: 35%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent); animation: flow 1.2s linear infinite; }
        .pipe-stopped { background: #e2e8f0; }
        .pipe-stopped .pipe-flow { display: none; }

        .tank-meter { display: flex; align-items: stretch; gap: 7px; }
        .tank-meter.compact { gap: 6px; }
        .tank-outer { border: 2px solid #94a3b8; border-radius: 7px; background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%); overflow: hidden; position: relative; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.75); }
        .field-tank { width: 50px; height: 80px; border: 1.5px solid #94a3b8; border-radius: 6px; background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%); overflow: hidden; position: relative; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.75); }
        .tank-outer::before, .field-tank::before {
          content: '';
          position: absolute;
          inset: 4px auto 4px 4px;
          width: 24%;
          background: linear-gradient(180deg, rgba(255,255,255,0.75), rgba(255,255,255,0.08));
          border-radius: 999px;
          pointer-events: none;
          z-index: 3;
        }
        .water-fill {
          position: absolute;
          left: 0;
          bottom: 0;
          width: 100%;
          overflow: hidden;
          transition: height 1.2s cubic-bezier(0.4, 0, 0.2, 1);
          background: linear-gradient(180deg, #67c7f4 0%, #38bdf8 55%, #0ea5e9 100%);
        }
        .water-wave {
          position: absolute;
          top: -6px;
          left: -24%;
          width: 148%;
          height: 12px;
          background: rgba(255,255,255,0.24);
          border-radius: 45% 55% 0 0;
          animation: waterWave 4.2s ease-in-out infinite;
          pointer-events: none;
        }
        .water-value {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 10px;
          font-weight: 700;
          color: #075985;
          text-shadow: 0 1px 4px rgba(255,255,255,0.92);
          z-index: 4;
        }
        .tank-outer .water-value {
          font-size: 12px;
        }
        .water-scale {
          position: relative;
          width: 28px;
          height: 80px;
          color: #475569;
          font-size: 9px;
          flex-shrink: 0;
        }
        .water-scale.compact {
          height: 62px;
          width: 28px;
          font-size: 8px;
        }
        .scale-tick {
          position: absolute;
          left: 0;
          transform: translateY(-50%);
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .scale-tick.top-edge {
          transform: translateY(0);
        }
        .scale-tick.bottom-edge {
          transform: translateY(-100%);
        }
        .water-scale.compact {
          height: 80px;
        }
        .water-scale.compact .scale-tick {
          gap: 3px;
        }
        .scale-line {
          width: 9px;
          height: 1px;
          background: #94a3b8;
          display: block;
        }
        .scale-tick.emphasis .scale-line {
          width: 12px;
          background: #475569;
        }
        .scale-label {
          font-weight: 800;
          line-height: 1;
          white-space: nowrap;
        }
        .scale-unit {
          position: absolute;
          top: -12px;
          right: 0;
          font-size: 8px;
          font-weight: 700;
          letter-spacing: 0.04em;
          text-transform: uppercase;
          color: #94a3b8;
        }
        .ph-track { width: 100%; height: 10px; border-radius: 5px; background: linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6); position: relative; margin: 5px 0; }
        .ph-dot { width: 13px; height: 13px; background: #1e293b; border-radius: 50%; position: absolute; top: -1.5px; transform: translateX(-50%); transition: left 1s cubic-bezier(0.4, 0, 0.2, 1); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .moisture-gauge {
          width: 164px;
          height: 112px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          overflow: visible;
        }
        .moisture-gauge-svg {
          transform: scale(1.16);
          transform-origin: center 56%;
        }
        .water-level-indicator {
          width: 84px;
          height: 92px;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          overflow: visible;
          margin-left: 0;
        }
        .water-level-indicator-inner {
          position: relative;
          width: 50px;
          transform: scale(1.16);
          transform-origin: top center;
          justify-content: center;
        }
        .water-level-indicator-inner .water-scale.compact {
          position: absolute;
          left: calc(100% + 6px);
          top: 0;
        }
        .gauge-arc { fill: none; stroke-linecap: round; transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .npk-track { flex: 1; height: 5px; background: #e2e8f0; border-radius: 3px; overflow: hidden; }
        .npk-fill { height: 100%; border-radius: 3px; transition: width 1s ease; }
        .thermo-indicator {
          width: 28px;
          height: 58px;
          position: relative;
          display: flex;
          align-items: flex-start;
          justify-content: center;
          padding-top: 2px;
          flex-shrink: 0;
        }
        .thermo-stem {
          width: 10px;
          height: 40px;
          border: 2px solid #cbd5e1;
          border-radius: 999px;
          background: linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%);
          overflow: hidden;
          position: relative;
          box-shadow: inset 0 0 0 1px rgba(255,255,255,0.8);
        }
        .thermo-fill {
          position: absolute;
          left: 1px;
          right: 1px;
          bottom: 1px;
          border-radius: 999px;
          transition: height 1s ease, background 0.35s ease;
        }
        .thermo-bulb {
          position: absolute;
          left: 50%;
          bottom: 0;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          transform: translateX(-50%);
          border: 2px solid rgba(255,255,255,0.92);
          transition: background 0.35s ease, box-shadow 0.35s ease;
        }
        .thermo-highlight {
          position: absolute;
          top: 6px;
          left: 50%;
          width: 3px;
          height: 24px;
          transform: translateX(-50%);
          border-radius: 999px;
          background: rgba(255,255,255,0.55);
          pointer-events: none;
        }

        @media screen and (max-width: 1200px) {
          .dash-container {
            height: 100%;
          }
        }

        @media screen and (max-width: 1100px) {
          .quad-grid,
          .overview-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div
        className="dash-frame"
        style={{
          width: '100%',
          height: `${dashboardHeight}px`,
        }}
      >
        <div
          className="dash"
          ref={dashRef}
          style={{
            height: `${dashboardHeight}px`,
          }}
        >
        <div className="quad-grid">
          <div className="quad-section">
            <div className="overview-grid">
          <div className="card greenhouse-card">
            <div className="ctitle">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/></svg>
              Main Tank System
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
              <div className="col">
                <div style={{ width: '36px', height: '36px', border: '2px solid #64748b', borderRadius: '6px', background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="25" height="25" viewBox="0 0 24 24" fill="none">
                    <rect x="3" y="5" width="18" height="6" rx="2" fill="#8b5a2b" />
                    <rect x="3" y="11" width="18" height="9" rx="2" fill="#38bdf8" />
                    <path d="M3 11C5 10.2 6.5 9.9 8 9.9C9.8 9.9 11 10.5 12.4 11.2C13.6 11.8 14.7 12.2 16.3 12.2C17.8 12.2 19.1 11.8 21 11" stroke="#e0f2fe" strokeWidth="1.4" strokeLinecap="round" />
                    <path d="M5 8H19" stroke="#6b4423" strokeWidth="1.2" strokeLinecap="round" opacity="0.75" />
                  </svg>
                </div>
                <span className="lbl">Reservoir</span>
              </div>
              <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className="pipe-flow"></div></div>
              <div className="col">
                <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '2px solid #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', background: state.pumping ? '#e0f2fe' : '#fef2f2', transition: 'background 0.8s' }}>
                  <svg width="25" height="25" viewBox="0 0 36 36" className={state.pumping ? 'spin-med' : 'spin-stop'}>
                    <path d="M18 18C18 10 26 6 28 12C30 18 24 20 18 18Z" fill={state.pumping ? '#0ea5e9' : '#f87171'} opacity="0.9"/>
                    <path d="M18 18C26 18 30 26 24 28C18 30 16 24 18 18Z" fill={state.pumping ? '#0ea5e9' : '#f87171'} opacity="0.9"/>
                    <path d="M18 18C18 26 10 30 8 24C6 18 12 16 18 18Z" fill={state.pumping ? '#0ea5e9' : '#f87171'} opacity="0.9"/>
                    <path d="M18 18C10 18 6 10 12 8C18 6 20 12 18 18Z" fill={state.pumping ? '#0ea5e9' : '#f87171'} opacity="0.9"/>
                    <circle cx="18" cy="18" r="4" fill={state.pumping ? '#0369a1' : '#b91c1c'}/>
                  </svg>
                </div>
                <span className="lbl">Pump</span>
              </div>
              <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className="pipe-flow"></div></div>
              <div className="col">
                <div className="tank-meter">
                  <div className="tank-outer" style={{ width: '64px', height: '104px' }}>
                    <AnimatedWaterFill height={`${state.tank.toFixed(1)}%`} label={`${Math.round(state.tank)}%`} />
                  </div>
                  <WaterScale ticks={mainTankScaleTicks} />
                </div>
                <span className="lbl">Tank</span>
              </div>
            </div>
            <div style={{ marginTop: '14px', borderTop: '0.5px solid #f1f5f9', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="stat-row"><span style={{ fontSize: '20px', fontWeight: 700, color: '#64748b' }}>Flow rate</span><span style={{ fontWeight: 500, color: '#0369a1' }}>{state.flowRate.toFixed(1)} L/min</span></div>
              <div className="stat-row"><span style={{ fontSize: '20px', fontWeight: 700, color: '#64748b' }}>Fill time</span><span style={{ fontWeight: 500, color: '#0369a1' }}>{state.pumping ? (remTime > 0 ? `~${remTime}s` : 'Full') : 'Stopped'}</span></div>
              <div className="stat-row" style={{ border: 'none' }}><span style={{ fontSize: '20px', fontWeight: 700, color: '#64748b' }}>Pump status</span><span className="badge" style={{ background: state.pumping ? '#dbeafe' : '#f1f5f9', color: state.pumping ? '#1e40af' : '#475569' }}>{state.pumping ? 'Active' : 'Idle'}</span></div>
            </div>
          </div>

          <div className="card greenhouse-card">
            <div className="ctitle">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              Greenhouse
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', alignItems: 'center', paddingBottom: '10px' }}>
              <div className="col" style={{ gap: '5px' }}>
                <div style={{ width: '52px', height: '52px', border: '1.5px solid #e2e8f0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
                  <svg width="45" height="45" viewBox="0 0 36 36" className={fanOn ? fanSpeedClass : 'spin-stop'}>
                    <path d="M18 18C18 10 26 6 28 12C30 18 24 20 18 18Z" fill="#0d9488" opacity="0.85"/>
                    <path d="M18 18C26 18 30 26 24 28C18 30 16 24 18 18Z" fill="#0d9488" opacity="0.85"/>
                    <path d="M18 18C18 26 10 30 8 24C6 18 12 16 18 18Z" fill="#0d9488" opacity="0.85"/>
                    <path d="M18 18C10 18 6 10 12 8C18 6 20 12 18 18Z" fill="#0d9488" opacity="0.85"/>
                    <circle cx="18" cy="18" r="3.5" fill="#134e4a"/>
                  </svg>
                </div>
                <span className="lbl">Fan</span>
                <span className="badge" style={{ background: fanOn ? '#dcfce7' : '#f1f5f9', color: fanOn ? '#15803d' : '#475569' }}>{fanOn ? 'ON' : 'OFF'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '8px' }}>
                <div className="row">
                  <div className="thermo-indicator">
                    <div className="thermo-stem">
                      <div
                        className="thermo-fill"
                        style={{
                          height: `${greenhouseTempPct}%`,
                          background: `linear-gradient(180deg, ${greenhouseTempColor}cc 0%, ${greenhouseTempColor} 100%)`,
                        }}
                      ></div>
                      <div className="thermo-highlight"></div>
                    </div>
                    <div
                      className="thermo-bulb"
                      style={{
                        background: `radial-gradient(circle at 35% 35%, #ffffff 0%, ${greenhouseTempColor} 65%)`,
                        boxShadow: `0 4px 12px ${greenhouseTempColor}55`,
                      }}
                    ></div>
                  </div>
                  <div>
                    <div style={{ fontSize: '17px', fontWeight: 600, color: greenhouseTempColor }}>{state.gh.temp.toFixed(1)}°C</div>
                    <div style={{ fontSize: '20px', fontWeight: 900, color: '#94a3b8' }}>Temperature</div>
                  </div>
                </div>
                <div className="row">
                  <svg width="30" height="30" viewBox="0 0 14 20"><path d="M7 1Q11 7 11 12A4 4 0 0 1 3 12Q3 7 7 1Z" fill="#38bdf8"/></svg>
                  <div>
                    <div style={{ fontSize: '17px', fontWeight: 600, color: '#0ea5e9' }}>{Math.round(state.gh.humidity)}%</div>
                    <div style={{ fontSize: '20px', fontWeight: 900, color: '#94a3b8' }}>Humidity</div>
                  </div>
                </div>
              </div>
              </div>
              <div style={{ flex: 1, borderTop: '0.5px solid #f1f5f9', paddingTop: '10px', display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '20px', fontWeight: 800, color: '#0d9488', marginBottom: '8px' }}>Farm House</div>
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', animation: fireOn ? 'blink 0.8s step-end infinite' : 'none' }}>
                  <svg width="40" height="50" viewBox="0 0 20 26">
                    <path d="M10 1Q15 8 15 15A5 5 0 0 1 5 15Q5 8 10 1Z" fill={fireOn ? '#ef4444' : '#94a3b8'}/>
                    <path d="M10 12Q13 15 13 18A3 3 0 0 1 7 18Q7 15 10 12Z" fill={fireOn ? '#ef4444' : '#e2e8f0'}/>
                  </svg>
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: 900, color: fireOn ? '#dc2626' : '#16a34a' }}>{fireOn ? 'Fire Detected!' : 'Safe'}</div>
                    <div style={{ fontSize: '20px', fontWeight: 900, color: '#94a3b8' }}>Fire Alert</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
            </div>
          </div>

          <div className="quad-section">
            <FieldCard data={state.f1} title="Field 1" />
          </div>

          <div className="quad-section">
            <FieldCard data={state.f2} title="Field 2" />
          </div>

          <div className="quad-section">
            <FieldCard data={state.f3} title="Field 3" />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default AgricultureDashboard;

