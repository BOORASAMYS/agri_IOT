import React, { useState, useEffect, useRef } from 'react';

const AgricultureDashboard = () => {
  const BASE_DASHBOARD_WIDTH = 1360;
  // --- INITIAL STATE (Unchanged) ---
  const [state, setState] = useState({
    tank: 100,
    pumping: true,
    flowRate: 2.4,
    gh: { temp: 35, humidity: 65, fireAlert: false, fanOn: false },
    f1: { moisture: 62.4, ph: 6.81, wl: 21.3, n: 42, p: 35, k: 55, irrigation: true, drain: true, acid: true, base: false },
    f2: { moisture: 60.8, ph: 8.10, wl: 13.3, n: 38, p: 28, k: 48, irrigation: false, drain: false, acid: false, base: false },
    f3: { moisture: 24, ph: 3.2, wl: 8.5, n: 22, p: 18, k: 31, irrigation: true, drain: false, acid: false, base: true },
    time: ''
  });

  const [isMounted, setIsMounted] = useState(false);
  const [dashboardHeight, setDashboardHeight] = useState(640);
  const [dashboardScale, setDashboardScale] = useState(1);
  const shellRef = useRef(null);
  const dashRef = useRef(null);

  // --- INITIALIZE TIME ON CLIENT SIDE AFTER HYDRATION ---
  useEffect(() => {
    setIsMounted(true);
    setState(prevState => ({ ...prevState, time: new Date().toLocaleTimeString() }));
  }, []);

  useEffect(() => {
    const updateLayout = () => {
      if (!shellRef.current || !dashRef.current) return;

      const naturalHeight = Math.max(dashRef.current.scrollHeight, 1);
      const naturalWidth = Math.max(dashRef.current.scrollWidth, BASE_DASHBOARD_WIDTH, 1);
      const shellHeight = Math.max(shellRef.current.clientHeight, 1);
      const shellWidth = Math.max(shellRef.current.clientWidth, 1);
      const fitScale = Math.min(shellHeight / naturalHeight, shellWidth / naturalWidth);

      setDashboardHeight(naturalHeight);
      setDashboardScale(fitScale);
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

  const remTime = Math.max(0, Math.round((80 - state.tank) / (state.flowRate || 1) * 25));
  const fanOn = state.gh.fanOn;
  const fireOn = state.gh.fireAlert;
  const fanSpeedClass = fanOn ? "spin-med" : "spin-stop";
  const greenhouseTempPct = Math.min((state.gh.temp / 60) * 100, 100);
  const greenhouseTempColor =
    state.gh.temp <= 24 ? '#3b82f6' : state.gh.temp <= 35 ? '#f59e0b' : '#ef4444';
  const mainTankFillPct = Math.min(state.tank, 100);
  const mainTankScaleTicks = [
    { value: 100, position: 100, emphasis: true },
    { value: 75, position: 75 },
    { value: 50, position: 50 },
    { value: 25, position: 25 },
    { value: 0, position: 0, emphasis: true }
  ];

  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const bump = (value, step, min, max, digits = 1) => {
    const next = value + step > max ? min : value + step;
    return Number(next.toFixed(digits));
  };
  const getClientPoint = (event) => {
    if (event.touches && event.touches[0]) {
      return { x: event.touches[0].clientX, y: event.touches[0].clientY };
    }
    if (event.changedTouches && event.changedTouches[0]) {
      return { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
    }
    return { x: event.clientX, y: event.clientY };
  };

  const StatusChip = ({ on, label, onClick, activeColor = '#16a34a' }) => (
    <span
      onClick={onClick}
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', width: '100%', fontSize: '20px', fontWeight: 700, color: on ? activeColor : '#94a3b8', cursor: 'pointer', userSelect: 'none', textAlign: 'center' }}
      title={`Toggle ${label}`}
    >
      <span className="dot" style={{ background: on ? activeColor : '#cbd5e1' }}></span>
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

  const FieldCard = ({ data, title, fieldKey }) => {
    const [isMoistureDragging, setIsMoistureDragging] = useState(false);
    const [dragTarget, setDragTarget] = useState(null);
    const [liveField, setLiveField] = useState(null);
    const activeDragRef = useRef(null);
    const moistureGaugeRef = useRef(null);
    const phTrackRef = useRef(null);
    const npkTrackRefs = useRef({});
    const dragStartRef = useRef({ x: 0, y: 0 });
    const dragArmedRef = useRef(false);
    const pendingFieldPatchRef = useRef({});
    const dragListenersBoundRef = useRef(false);
    const dragCleanupRef = useRef(null);
    const moistureValue = liveField?.moisture ?? data.moisture;
    const phValue = liveField?.ph ?? data.ph;
    const nValue = liveField?.n ?? data.n;
    const pValue = liveField?.p ?? data.p;
    const kValue = liveField?.k ?? data.k;
    const mc = moistureColor(moistureValue);
    const phPct = (phValue / 14 * 100).toFixed(1);
    const wlPct = Math.min(data.wl / 30 * 100, 100);
    const moistureAngle = -90 + (moistureValue / 100) * 180;
    const fieldScaleTicks = [
      { value: 30, position: 100, emphasis: true },
      { value: 20, position: 66.7 },
      { value: 10, position: 33.3 },
      { value: 0, position: 0, emphasis: true }
    ];
    const updateField = (patch) => {
      setState((prev) => ({
        ...prev,
        [fieldKey]: { ...prev[fieldKey], ...patch },
      }));
    };
    const scheduleFieldPatch = (patch) => {
      pendingFieldPatchRef.current = { ...pendingFieldPatchRef.current, ...patch };
    };
    const setLivePatch = (patch) => {
      setLiveField((prev) => ({ ...(prev ?? {}), ...patch }));
    };
    const flushFieldPatch = () => {
      const nextPatch = pendingFieldPatchRef.current;
      pendingFieldPatchRef.current = {};
      if (Object.keys(nextPatch).length) {
        updateField(nextPatch);
      }
    };
    const setMoistureFromPointer = (clientX, clientY) => {
      if (!moistureGaugeRef.current) return;
      const rect = moistureGaugeRef.current.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 164;
      const y = ((clientY - rect.top) / rect.height) * 112;
      const rawAngle = Math.atan2(x - 78, 72 - y) * (180 / Math.PI);
      const clampedAngle = clamp(rawAngle, -90, 90);
      const moisture = ((clampedAngle + 90) / 180) * 100;
      const next = Number(moisture.toFixed(1));
      setLivePatch({ moisture: next });
      scheduleFieldPatch({ moisture: next });
    };
    const setPhFromPointer = (clientX) => {
      if (!phTrackRef.current) return;
      const rect = phTrackRef.current.getBoundingClientRect();
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      const next = Number((pct * 14).toFixed(2));
      setLivePatch({ ph: next });
      scheduleFieldPatch({ ph: next });
    };
    const setNpkFromPointer = (key, clientX) => {
      const track = npkTrackRefs.current[key];
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      const next = Number((pct * 100).toFixed(1));
      setLivePatch({ [key]: next });
      scheduleFieldPatch({ [key]: next });
    };
    const startDrag = (target, startX, startY) => {
      if (activeDragRef.current) {
        endDrag();
      }
      setLiveField({ moisture: data.moisture, ph: data.ph, n: data.n, p: data.p, k: data.k });
      activeDragRef.current = target;
      dragStartRef.current = { x: startX, y: startY };
      dragArmedRef.current = false;
      setDragTarget(target.type === 'moisture' ? null : target.type === 'ph' ? 'ph' : target.key);
      setIsMoistureDragging(target.type === 'moisture');
    };
    const processDragMove = (clientX, clientY) => {
      if (!activeDragRef.current) return;
      dragArmedRef.current = true;
      if (activeDragRef.current.type === 'moisture') {
        setMoistureFromPointer(clientX, clientY);
        return;
      }
      if (activeDragRef.current.type === 'ph') {
        setPhFromPointer(clientX);
        return;
      }
      if (activeDragRef.current.type === 'npk') {
        setNpkFromPointer(activeDragRef.current.key, clientX);
      }
    };
    const endDrag = () => {
      activeDragRef.current = null;
      dragArmedRef.current = false;
      setIsMoistureDragging(false);
      setDragTarget(null);
      flushFieldPatch();
      setLiveField(null);
    };
    const bindGlobalDragListeners = () => {
      if (dragListenersBoundRef.current) return;
      const supportsPointer = typeof window !== 'undefined' && 'PointerEvent' in window;
      const onMove = (event) => {
        if (!activeDragRef.current) return;
        if (event.cancelable) event.preventDefault();
        const point = getClientPoint(event);
        processDragMove(point.x, point.y);
      };
      const onEnd = () => {
        if (!activeDragRef.current) return;
        endDrag();
        unbindGlobalDragListeners();
      };
      if (supportsPointer) {
        window.addEventListener('pointermove', onMove, { passive: false });
        window.addEventListener('pointerup', onEnd);
        window.addEventListener('pointercancel', onEnd);
      } else {
        window.addEventListener('mousemove', onMove, { passive: false });
        window.addEventListener('mouseup', onEnd);
        window.addEventListener('touchmove', onMove, { passive: false });
        window.addEventListener('touchend', onEnd);
        window.addEventListener('touchcancel', onEnd);
      }
      dragCleanupRef.current = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onEnd);
        window.removeEventListener('touchcancel', onEnd);
      };
      dragListenersBoundRef.current = true;
    };
    const unbindGlobalDragListeners = () => {
      if (!dragListenersBoundRef.current) return;
      if (dragCleanupRef.current) dragCleanupRef.current();
      dragCleanupRef.current = null;
      dragListenersBoundRef.current = false;
    };

    useEffect(() => {
      return () => {
        endDrag();
        unbindGlobalDragListeners();
      };
    }, []);

    return (
      <div className="card">
        <div className="ctitle field-title">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/></svg>
          {title}
          <span
            className="dot field-status-dot"
            style={{
              marginLeft: 'auto',
              background: data.irrigation ? '#3b82f6' : data.drain ? '#ef4444' : 'transparent',
              border: data.irrigation || data.drain ? 'none' : '1px solid transparent'
            }}
          ></span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(170px, 1.35fr) minmax(90px, 0.8fr) minmax(120px, 1fr)', columnGap: '6px', rowGap: '14px', alignItems: 'start' }}>
          <div className="col">
            <div className="moisture-gauge" style={{ cursor: isMoistureDragging ? 'grabbing' : 'grab' }} title="Drag needle left/right to set moisture">
              <svg
                ref={moistureGaugeRef}
                className="moisture-gauge-svg"
                width="164"
                height="112"
                viewBox="0 0 164 112"
                style={{ overflow: 'visible', touchAction: 'none' }}
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  startDrag({ type: 'moisture' }, event.clientX, event.clientY);
                  setMoistureFromPointer(event.clientX, event.clientY);
                  bindGlobalDragListeners();
                }}
                onPointerMove={(event) => {
                  if (!activeDragRef.current || activeDragRef.current.type !== 'moisture') return;
                  processDragMove(event.clientX, event.clientY);
                }}
                onPointerUp={() => {
                  if (activeDragRef.current && activeDragRef.current.type === 'moisture') {
                    endDrag();
                    unbindGlobalDragListeners();
                  }
                }}
                onPointerCancel={() => {
                  if (activeDragRef.current && activeDragRef.current.type === 'moisture') {
                    endDrag();
                    unbindGlobalDragListeners();
                  }
                }}
                onLostPointerCapture={() => {
                  if (activeDragRef.current && activeDragRef.current.type === 'moisture') {
                    endDrag();
                    unbindGlobalDragListeners();
                  }
                }}
                onTouchStart={(event) => {
                  if (typeof window !== 'undefined' && 'PointerEvent' in window) return;
                  if (!event.touches[0]) return;
                  if (event.cancelable) event.preventDefault();
                  startDrag({ type: 'moisture' }, event.touches[0].clientX, event.touches[0].clientY);
                  bindGlobalDragListeners();
                }}
              >
                <path d="M24 72 A54 54 0 0 1 132 72" fill="none" stroke="#dbe4f0" strokeWidth="13" strokeLinecap="round" />
                <path
                  d="M24 72 A54 54 0 0 1 132 72"
                  fill="none"
                  stroke={mc}
                  strokeWidth="13"
                  strokeLinecap="round"
                  strokeDasharray={`${(moistureValue / 100) * 170} 170`}
                  className="gauge-arc"
                />
                <g className={`moisture-needle ${isMoistureDragging ? 'dragging' : ''}`} style={{ transform: `rotate(${moistureAngle}deg)`, transformOrigin: '78px 72px' }}>
                  <line x1="78" y1="72" x2="78" y2="26" stroke="#64748b" strokeWidth="4" strokeLinecap="round" />
                  <circle cx="78" cy="26" r="4.5" fill="#64748b" />
                </g>
                <circle cx="78" cy="72" r="11" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
                <circle cx="78" cy="72" r="5.5" fill={mc} />
                <text x="7" y="82" fontSize="11" fontWeight="800" fill="#475569">0</text>
                <text x="74" y="10" fontSize="11" fontWeight="800" fill="#475569">50</text>
                <text x="137" y="82" fontSize="11" fontWeight="800" fill="#475569">100</text>
                <rect x="48" y="80" width="60" height="28" rx="14" fill="#ffffff" stroke="#cbd5e1" strokeWidth="2" />
                <text x="78" y="98" textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a">{moistureValue.toFixed(1)}%</text>
              </svg>
            </div>
            <span className="lbl">Moisture</span>
          </div>
          <div className="col">
            <div className="water-level-indicator" onClick={() => updateField({ wl: bump(data.wl, 1, 0, 30, 1) })} style={{ cursor: 'pointer' }} title="Adjust water level">
              <div className="tank-meter compact water-level-indicator-inner">
                <div className="field-tank">
                  <AnimatedWaterFill height={`${wlPct}%`} />
                </div>
                <WaterScale ticks={fieldScaleTicks} compact />
              </div>
            </div>
            <div className="val" style={{ marginLeft: '-45px' }}>{data.wl.toFixed(1)} cm</div>
            <span className="lbl" style={{ marginLeft: '-45px' }}>Water</span>
          </div>
          <div className="col" style={{ width: '100%' }}>
            <div style={{ width: '100%', fontSize: '10px', color: '#475569', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}><span>0</span><span>7</span><span>14</span></div>
            <div
              ref={phTrackRef}
              className={`ph-track ${dragTarget === 'ph' ? 'dragging' : ''}`}
              onPointerDown={(event) => {
                event.preventDefault();
                event.currentTarget.setPointerCapture(event.pointerId);
                startDrag({ type: 'ph' }, event.clientX, event.clientY);
                setPhFromPointer(event.clientX);
                bindGlobalDragListeners();
              }}
              onPointerMove={(event) => {
                if (!activeDragRef.current || activeDragRef.current.type !== 'ph') return;
                processDragMove(event.clientX, event.clientY);
              }}
              onPointerUp={() => {
                if (activeDragRef.current && activeDragRef.current.type === 'ph') {
                  endDrag();
                  unbindGlobalDragListeners();
                }
              }}
              onPointerCancel={() => {
                if (activeDragRef.current && activeDragRef.current.type === 'ph') {
                  endDrag();
                  unbindGlobalDragListeners();
                }
              }}
              onLostPointerCapture={() => {
                if (activeDragRef.current && activeDragRef.current.type === 'ph') {
                  endDrag();
                  unbindGlobalDragListeners();
                }
              }}
              onTouchStart={(event) => {
                if (typeof window !== 'undefined' && 'PointerEvent' in window) return;
                if (!event.touches[0]) return;
                if (event.cancelable) event.preventDefault();
                startDrag({ type: 'ph' }, event.touches[0].clientX, event.touches[0].clientY);
                bindGlobalDragListeners();
              }}
              style={{ cursor: dragTarget === 'ph' ? 'grabbing' : 'grab', touchAction: 'none' }}
              title="Drag to set pH"
            >
              <div className={`ph-dot ${dragTarget === 'ph' ? 'dragging' : ''}`} style={{ left: `${phPct}%` }}></div>
            </div>
            <div style={{ textAlign: 'center', fontSize: '20px', fontWeight: '900', color: phColor(phValue) }}>{phValue.toFixed(2)}</div>
            <span className="lbl">pH</span>
          </div>
        </div>
        <div style={{ marginTop: '14px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {[ {l:'N', key:'n', v:nValue, c:'#22c55e'}, {l:'P', key:'p', v:pValue, c:'#f59e0b'}, {l:'K', key:'k', v:kValue, c:'#8b5cf6'} ].map(item => (
               <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }} title={`Drag to adjust ${item.l}`}>
                <span style={{ color: item.c, fontSize: '20px', fontWeight: 900, width: '50px' }}>{item.l}</span>
                 <div
                   ref={(el) => { npkTrackRefs.current[item.key] = el; }}
                   className={`npk-track interactive ${dragTarget === item.key ? 'dragging' : ''}`}
                   onPointerDown={(event) => {
                     event.preventDefault();
                     event.currentTarget.setPointerCapture(event.pointerId);
                     startDrag({ type: 'npk', key: item.key }, event.clientX, event.clientY);
                     setNpkFromPointer(item.key, event.clientX);
                     bindGlobalDragListeners();
                   }}
                   onPointerMove={(event) => {
                     if (!activeDragRef.current || activeDragRef.current.type !== 'npk' || activeDragRef.current.key !== item.key) return;
                     processDragMove(event.clientX, event.clientY);
                   }}
                   onPointerUp={() => {
                     if (activeDragRef.current && activeDragRef.current.type === 'npk' && activeDragRef.current.key === item.key) {
                       endDrag();
                       unbindGlobalDragListeners();
                     }
                   }}
                   onPointerCancel={() => {
                     if (activeDragRef.current && activeDragRef.current.type === 'npk' && activeDragRef.current.key === item.key) {
                       endDrag();
                       unbindGlobalDragListeners();
                     }
                   }}
                   onLostPointerCapture={() => {
                     if (activeDragRef.current && activeDragRef.current.type === 'npk' && activeDragRef.current.key === item.key) {
                       endDrag();
                       unbindGlobalDragListeners();
                     }
                   }}
                   onTouchStart={(event) => {
                     if (typeof window !== 'undefined' && 'PointerEvent' in window) return;
                     if (!event.touches[0]) return;
                     if (event.cancelable) event.preventDefault();
                     startDrag({ type: 'npk', key: item.key }, event.touches[0].clientX, event.touches[0].clientY);
                     setNpkFromPointer(item.key, event.touches[0].clientX);
                     bindGlobalDragListeners();
                   }}
                   style={{ cursor: dragTarget === item.key ? 'grabbing' : 'grab', touchAction: 'none' }}
                 >
                  <div className="npk-fill" style={{ width: `${item.v}%`, background: item.c }}></div>
                  <div className={`npk-dot ${dragTarget === item.key ? 'dragging' : ''}`} style={{ left: `${item.v}%`, background: item.c }}></div>
                 </div>
                 <span style={{ color: '#334155', fontSize: '17px', fontWeight: 700, width: '36px', textAlign: 'right', lineHeight: 1 }}>{item.v}</span>
               </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: '10px', paddingTop: '9px', borderTop: '0.5px solid #f1f5f9', display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', columnGap: '10px', alignItems: 'center' }}>
          <StatusChip on={data.irrigation} label="Irrigation" activeColor="#3b82f6" onClick={() => updateField({ irrigation: !data.irrigation })} />
          <StatusChip on={data.drain} label="Drain" activeColor="#ef4444" onClick={() => updateField({ drain: !data.drain })} />
          <StatusChip on={data.acid} label="Acid" onClick={() => updateField({ acid: !data.acid })} />
          <StatusChip on={data.base} label="Base" onClick={() => updateField({ base: !data.base })} />
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
          padding: 18px 18px; 
          border-radius: 12px; 
          margin-bottom: 12px; 
          display: flex; 
          align-items: center; 
          gap: 15px; 
          font-size: 26px; 
          font-weight: 800; 
          box-shadow: 0 2px 8px rgba(13,148,136,0.18); 
        }

        .nav-link {
          background: rgba(255, 255, 255, 0.15);
          color: white;
          border: none;
          padding: 6px 14px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 26px;
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
        .ctitle { font-size: 25px; font-weight: 800; color: #0d9488; margin-bottom: 12px; display: flex; align-items: center; gap: 8px; }
        .field-title { font-size: 24px; }
        .lbl { font-size: 20px; font-weight: 900; color: #94a3b8; text-align: center; margin-top: 4px; }
        .val { font-size: 17px; font-weight: 700; color: #1e293b; text-align: center; line-height: 1.2; }
        .col { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
        .row { display: flex; align-items: center; gap: 9px; }
        .badge { font-size: 12px; padding: 3px 10px; border-radius: 20px; font-weight: 600; display: inline-block; }
        .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .field-status-dot {
          width: 12px;
          height: 12px;
          animation: slowPulse 2.2s ease-in-out infinite;
        }
        .stat-row { display: flex; align-items: center; justify-content: space-between; font-size: 13px; padding: 7px 0; border-bottom: 0.5px solid #f1f5f9; }
        
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes flow { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        @keyframes blink { 50% { opacity: 0.15; } }
        @keyframes slowPulse {
          0% { opacity: 0.35; transform: scale(0.92); }
          50% { opacity: 1; transform: scale(1.08); }
          100% { opacity: 0.35; transform: scale(0.92); }
        }
        @keyframes waterWave {
          0% { transform: translateX(-24%) translateY(0); }
          50% { transform: translateX(-16%) translateY(2px); }
          100% { transform: translateX(-24%) translateY(0); }
        }
        
        .spin-slow { animation: spin 2.5s linear infinite; }
        .spin-med { animation: spin 1s linear infinite; }
        .spin-fast { animation: spin 0.35s linear infinite; }
        .spin-turbo { animation: spin 0.18s linear infinite; }
        .spin-stop { }

        .pipe { position: relative; overflow: hidden; border-radius: 3px; background: #bae6fd; height: 6px; width: 28px; }
        .pipe-flow { position: absolute; top: 0; left: 0; width: 35%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent); animation: flow 1.2s linear infinite; }
        .pipe-stopped { background: #e2e8f0; }
        .pipe-stopped .pipe-flow { display: none; }

        .tank-meter { display: flex; align-items: stretch; gap: 7px; }
        .tank-meter.compact { gap: 6px; }
        .tank-outer { border: 2px solid #94a3b8; border-radius: 7px; background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%); overflow: hidden; position: relative; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.75); }
        .main-tank-shell {
          border: none;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
          overflow: visible;
        }
        .main-tank-shell::before,
        .main-tank-shell::after {
          display: none;
        }
        .main-tank-cap {
          position: absolute;
          top: 8px;
          left: 50%;
          width: 28px;
          height: 9px;
          transform: translateX(-50%);
          border: 1.5px solid #475569;
          border-bottom: none;
          border-radius: 6px 6px 0 0;
          background: linear-gradient(180deg, #ffffff 0%, #edf3f8 100%);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.9);
          z-index: 6;
        }
        .main-tank-body {
          position: absolute;
          left: 22px;
          right: 22px;
          top: 17px;
          bottom: 10px;
          border: 1.7px solid #475569;
          border-radius: 12px 12px 6px 6px;
          background: linear-gradient(180deg, #ffffff 0%, #f3f7fb 38%, #e2e8f0 100%);
          box-shadow: inset 10px 0 14px rgba(255,255,255,0.7), inset -8px 0 12px rgba(148, 163, 184, 0.12), 0 4px 10px rgba(148, 163, 184, 0.08);
          z-index: 2;
          pointer-events: none;
        }
        .main-tank-water-zone {
          position: absolute;
          left: 25px;
          right: 25px;
          top: 28px;
          bottom: 14px;
          border-radius: 8px 8px 4px 4px;
          overflow: hidden;
          background: linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(248,250,252,0.98) 100%);
          box-shadow: inset 0 0 0 1px rgba(203, 213, 225, 0.7);
          z-index: 4;
        }
        .main-tank-water-zone .water-fill {
          opacity: 0.98;
          background: linear-gradient(180deg, #8fd8ff 0%, #4fc3f7 42%, #1da1f2 100%);
        }
        .main-tank-water-zone .water-value {
          font-size: 10px;
          font-weight: 600;
          color: #475569;
          text-shadow: 0 1px 2px rgba(255,255,255,0.85);
        }
        .main-tank-shell .main-tank-water-zone .water-value {
          font-size: 10px;
        }
        .field-tank { width: 50px; height: 80px; border: 1.5px solid #94a3b8; border-radius: 6px; background: linear-gradient(180deg, #f8fbff 0%, #eef6ff 100%); overflow: hidden; position: relative; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.75); }
        .tank-bg-image {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: cover;
          z-index: 1;
          opacity: 0.45;
        }
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
          z-index: 2;
          opacity: 0.82;
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
          font-size: 22px;
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
        .ph-track { width: 100%; height: 10px; border-radius: 5px; background: linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6); position: relative; margin: 5px 0; touch-action: none; }
        .ph-dot { width: 13px; height: 13px; background: #1e293b; border-radius: 50%; position: absolute; top: -1.5px; transform: translateX(-50%); transition: left 80ms linear; border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); will-change: left; }
        .ph-dot.dragging { transition: none; }
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
          margin-left: -45px;
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
        .gauge-arc { fill: none; stroke-linecap: round; transition: stroke-dasharray 80ms linear; will-change: stroke-dasharray; }
        .moisture-needle { transition: transform 80ms linear; will-change: transform; }
        .moisture-needle.dragging { transition: none; }
        .npk-track { flex: 1; height: 10px; background: #e2e8f0; border-radius: 5px; overflow: visible; position: relative; touch-action: none; }
        .npk-fill { height: 100%; border-radius: 3px; transition: width 80ms linear; will-change: width; }
        .npk-track.dragging .npk-fill { transition: none; }
        .npk-dot {
          position: absolute;
          top: 50%;
          width: 13px;
          height: 13px;
          border-radius: 50%;
          border: 2px solid #ffffff;
          transform: translate(-50%, -50%);
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.25);
          transition: left 80ms linear;
          will-change: left;
          z-index: 2;
        }
        .npk-dot.dragging { transition: none; }
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
        .gh-card-body {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-height: 100%;
        }
        .gh-panel {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 12px 14px;
          border: 1.5px solid #e2e8f0;
          border-radius: 16px;
          background: linear-gradient(180deg, #ffffff 0%, #f8fafc 100%);
          box-shadow: 0 2px 8px rgba(15, 23, 42, 0.04), inset 0 1px 0 rgba(255,255,255,0.72);
        }
        .gh-panel.compact {
          padding-top: 10px;
          padding-bottom: 10px;
        }
        .gh-panel-main {
          display: flex;
          align-items: center;
          gap: 12px;
          min-width: 0;
          flex: 1;
          justify-content: center;
        }
        .gh-panel-icon {
          width: 52px;
          height: 52px;
          border-radius: 50%;
          border: 1.5px solid #cfe0ea;
          background: radial-gradient(circle at 35% 35%, #ffffff 0%, #eef6f8 58%, #dbeafe 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          box-shadow: 0 6px 14px rgba(15, 23, 42, 0.08), inset 0 1px 0 rgba(255,255,255,0.92);
        }
        .gh-panel-copy {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .gh-fan-label {
          font-size: 18px;
          font-weight: 800;
          transition: color 0.2s ease;
        }
        .gh-stepper {
          display: flex;
          align-items: center;
          gap: 14px;
          flex-shrink: 0;
        }
        .gh-step-btn {
          width: 38px;
          height: 30px;
          border-radius: 10px;
          border: 1px solid #cbd5e1;
          background: #ffffff;
          color: #475569;
          cursor: pointer;
          line-height: 1;
          font-size: 18px;
          font-weight: 800;
          box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
        }
        .gh-reading {
          display: flex;
          align-items: center;
          gap: 10px;
          min-width: 0;
        }
        .gh-reading-value {
          font-size: 20px;
          font-weight: 900;
          letter-spacing: 0.01em;
          white-space: nowrap;
        }
        .gh-reading-value.temp {
          color: #f59e0b;
        }
        .gh-reading-value.humidity {
          color: #0ea5e9;
        }
        .farmhouse-panel {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 14px 14px 8px;
          margin-top: 4px;
        }
        .farmhouse-heading {
          font-size: 25px;
          font-weight: 800;
          color: #0d9488;
        }
        .farmhouse-alert {
          width: 46px;
          height: 46px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 5px;
          border-radius: 14px;
          border: 1.5px solid #d1d5db;
          background: linear-gradient(180deg, #f8fafc 0%, #eef2f7 100%);
          box-shadow: 0 3px 10px rgba(148, 163, 184, 0.1);
          cursor: pointer;
        }
        .farmhouse-alert.active {
          border-color: #fca5a5;
          background: linear-gradient(180deg, #fff7ed 0%, #fee2e2 100%);
          box-shadow: 0 6px 16px rgba(239, 68, 68, 0.16);
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
          .farmhouse-panel {
            padding-left: 0;
            padding-right: 0;
          }
        }
      `}</style>

      <div
        className="dash-frame"
        style={{
          width: '100%',
          height: '100%',
        }}
      >
        <div
          className="dash"
          ref={dashRef}
          style={{
            height: `${dashboardHeight}px`,
            transform: `scale(${dashboardScale})`,
            transformOrigin: 'top center',
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
                <div style={{ width: '65px', height: '65px', borderRadius: '8px', overflow: 'hidden', background: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(15, 23, 42, 0.12)' }}>
                  <img src="/ground.jpg" alt="Ground water" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
                <span className="lbl">Reservoir</span>
              </div>
              <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className="pipe-flow"></div></div>
              <div className="col">
                <div
                  style={{ width: '62px', height: '62px', borderRadius: '50%', border: '2px solid #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', background: state.pumping ? 'radial-gradient(circle at 35% 35%, #f0f9ff 0%, #bfdbfe 62%, #7dd3fc 100%)' : 'radial-gradient(circle at 35% 35%, #fff1f2 0%, #fecdd3 62%, #fda4af 100%)', boxShadow: state.pumping ? '0 10px 22px rgba(14, 165, 233, 0.22)' : '0 8px 18px rgba(244, 63, 94, 0.14)', transition: 'background 0.8s, box-shadow 0.3s', cursor: 'pointer' }}
                  onClick={() =>
                    setState((prev) => {
                      const pumping = !prev.pumping;
                      return {
                        ...prev,
                        pumping,
                        flowRate: pumping ? 2.4 : 0,
                      };
                    })
                  }
                  title="Toggle pump"
                >
                  <svg width="48" height="48" viewBox="0 0 56 56" aria-hidden="true">
                    <circle cx="28" cy="28" r="22" fill={state.pumping ? '#e0f2fe' : '#ffe4e6'} stroke={state.pumping ? '#38bdf8' : '#fda4af'} strokeWidth="2" />
                    <circle cx="28" cy="28" r="16" fill={state.pumping ? '#0ea5e9' : '#fb7185'} opacity="0.2" />
                    <g className={state.pumping ? 'spin-med' : 'spin-stop'} style={{ transformOrigin: '28px 28px' }}>
                      <path d="M28 12C32 12 37 14 39 18C34 18 30 20 28 24C26 20 22 18 17 18C19 14 24 12 28 12Z" fill={state.pumping ? '#0284c7' : '#e11d48'} />
                      <path d="M44 28C44 32 42 37 38 39C38 34 36 30 32 28C36 26 38 22 38 17C42 19 44 24 44 28Z" fill={state.pumping ? '#0284c7' : '#e11d48'} />
                      <path d="M28 44C24 44 19 42 17 38C22 38 26 36 28 32C30 36 34 38 39 38C37 42 32 44 28 44Z" fill={state.pumping ? '#0284c7' : '#e11d48'} />
                      <path d="M12 28C12 24 14 19 18 17C18 22 20 26 24 28C20 30 18 34 18 39C14 37 12 32 12 28Z" fill={state.pumping ? '#0284c7' : '#e11d48'} />
                    </g>
                    <circle cx="28" cy="28" r="6.5" fill={state.pumping ? '#075985' : '#9f1239'} />
                    <circle cx="28" cy="28" r="2.6" fill="#ffffff" />
                  </svg>
                </div>
                <span className="lbl">Pump</span>
              </div>
              <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className="pipe-flow"></div></div>
              <div className="col">
                <div className="tank-meter">
                  <div
                    className="tank-outer main-tank-shell"
                    style={{ width: '108px', height: '114px', cursor: 'pointer' }}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const pct = clamp((rect.bottom - event.clientY) / rect.height, 0, 1);
                      setState((prev) => ({ ...prev, tank: Number((pct * 100).toFixed(1)) }));
                    }}
                    title="Set tank level"
                  >
                    <div className="main-tank-cap"></div>
                    <div className="main-tank-body"></div>
                    <div className="main-tank-water-zone">
                      <AnimatedWaterFill height={`${mainTankFillPct.toFixed(1)}%`} label={`${Math.round(state.tank)}%`} />
                    </div>
                  </div>
                </div>
                <span className="lbl">Tank</span>
              </div>
            </div>
            <div style={{ marginTop: '14px', borderTop: '0.5px solid #f1f5f9', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="stat-row"><span style={{ fontSize: '20px', fontWeight: 700, color: '#64748b' }}>Flow rate</span><span style={{ fontSize: '22px', fontWeight: 500, color: '#0369a1' }}>{state.flowRate.toFixed(1)} L/min</span></div>
              <div className="stat-row"><span style={{ fontSize: '20px', fontWeight: 700, color: '#64748b' }}>Fill time</span><span style={{ fontSize: '22px', fontWeight: 500, color: '#0369a1' }}>0</span></div>
              <div className="stat-row" style={{ border: 'none' }}><span style={{ fontSize: '20px', fontWeight: 700, color: '#64748b' }}>Pump status</span><span className="badge" style={{ fontSize: '22px', background: state.pumping ? '#dbeafe' : '#f1f5f9', color: state.pumping ? '#1e40af' : '#475569' }}>{state.pumping ? 'Active' : 'Idle'}</span></div>
            </div>
          </div>

          <div className="card greenhouse-card">
            <div className="ctitle">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              Greenhouse
            </div>
            <div className="gh-card-body">
              <div className="gh-panel compact">
                <div className="gh-panel-main">
                  <div
                    className="gh-panel-icon"
                    onClick={() => setState((prev) => ({ ...prev, gh: { ...prev.gh, fanOn: !prev.gh.fanOn } }))}
                    style={{ background: fanOn ? 'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)' : 'linear-gradient(180deg, #ffffff 0%, #eef3f8 100%)', boxShadow: fanOn ? '0 6px 16px rgba(13, 148, 136, 0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.9)', cursor: 'pointer' }}
                    title="Toggle fan"
                    >
                      <svg width="36" height="36" viewBox="0 0 36 36" className={fanOn ? fanSpeedClass : 'spin-stop'}>
                      <path d="M18 18C18 9.8 26.6 7.1 28.5 12.6C30 17.1 24.3 19.4 18 18Z" fill="#0d9488" opacity="0.9"/>
                      <path d="M18 18C26.2 18 28.9 26.6 23.4 28.5C18.9 30 16.6 24.3 18 18Z" fill="#14b8a6" opacity="0.9"/>
                      <path d="M18 18C18 26.2 9.4 28.9 7.5 23.4C6 18.9 11.7 16.6 18 18Z" fill="#0d9488" opacity="0.9"/>
                      <path d="M18 18C9.8 18 7.1 9.4 12.6 7.5C17.1 6 19.4 11.7 18 18Z" fill="#14b8a6" opacity="0.9"/>
                      <circle cx="18" cy="18" r="5.1" fill="#134e4a"/>
                      <circle cx="18" cy="18" r="2.1" fill="#dffaf5"/>
                    </svg>
                  </div>
                  <span className="gh-fan-label" style={{ color: fanOn ? '#16a34a' : '#dc2626' }}>
                    Fan
                  </span>
                </div>
              </div>
              <div className="gh-panel">
                <div className="gh-stepper">
                  <button
                    type="button"
                    className="gh-step-btn"
                    onClick={() => setState((prev) => ({ ...prev, gh: { ...prev.gh, temp: clamp(Number((prev.gh.temp - 1).toFixed(1)), 20, 60) } }))}
                    title="Decrease temperature"
                  >
                    ▼
                  </button>
                </div>
                <div className="gh-reading">
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
                  <span className="gh-reading-value temp">{Math.round(state.gh.temp)}°</span>
                </div>
                <div className="gh-stepper">
                  <button
                    type="button"
                    className="gh-step-btn"
                    onClick={() => setState((prev) => ({ ...prev, gh: { ...prev.gh, temp: clamp(Number((prev.gh.temp + 1).toFixed(1)), 20, 60) } }))}
                    title="Increase temperature"
                  >
                    ▲
                  </button>
                </div>
              </div>
              <div className="gh-panel">
                <div className="gh-stepper">
                  <button
                    type="button"
                    className="gh-step-btn"
                    onClick={() => setState((prev) => ({ ...prev, gh: { ...prev.gh, humidity: clamp(prev.gh.humidity - 2, 30, 95) } }))}
                    title="Decrease humidity"
                  >
                    ▼
                  </button>
                </div>
                <div className="gh-reading">
                  <svg width="18" height="26" viewBox="0 0 14 20" aria-hidden="true"><path d="M7 1Q11 7 11 12A4 4 0 0 1 3 12Q3 7 7 1Z" fill="#38bdf8"/></svg>
                  <span className="gh-reading-value humidity">{Math.round(state.gh.humidity)}%</span>
                </div>
                <div className="gh-stepper">
                  <button
                    type="button"
                    className="gh-step-btn"
                    onClick={() => setState((prev) => ({ ...prev, gh: { ...prev.gh, humidity: clamp(prev.gh.humidity + 2, 30, 95) } }))}
                    title="Increase humidity"
                  >
                    ▲
                  </button>
                </div>
              </div>
              <div className="farmhouse-panel">
                <div className="farmhouse-heading">Farm House</div>
                <div
                  className={`farmhouse-alert ${fireOn ? 'active' : ''}`}
                  onClick={() => setState((prev) => ({ ...prev, gh: { ...prev.gh, fireAlert: !prev.gh.fireAlert } }))}
                  style={{
                    animation: fireOn ? 'blink 0.8s step-end infinite' : 'none'
                  }}
                  title="Toggle fire alert"
                >
                  <svg width="20" height="24" viewBox="0 0 48 58" aria-hidden="true">
                    <defs>
                      <linearGradient id="fireOuter" x1="0.5" y1="0" x2="0.5" y2="1">
                        <stop offset="0%" stopColor={fireOn ? '#fb923c' : '#cbd5e1'} />
                        <stop offset="55%" stopColor={fireOn ? '#ef4444' : '#94a3b8'} />
                        <stop offset="100%" stopColor={fireOn ? '#b91c1c' : '#64748b'} />
                      </linearGradient>
                      <linearGradient id="fireInner" x1="0.5" y1="0" x2="0.5" y2="1">
                        <stop offset="0%" stopColor={fireOn ? '#fde68a' : '#e2e8f0'} />
                        <stop offset="100%" stopColor={fireOn ? '#f97316' : '#cbd5e1'} />
                      </linearGradient>
                    </defs>
                    <path d="M24 2C31 10 36 17 36 27C36 34 32 39 29 42C33 39 39 34 39 26C45 33 46 39 46 44C46 52 37 58 24 58C11 58 2 52 2 44C2 33 11 26 16 22C17 29 20 33 24 36C21 31 20 26 20 21C20 12 23 7 24 2Z" fill="url(#fireOuter)" />
                    <path d="M24 18C28 23 31 27 31 34C31 40 27 45 24 47C21 45 17 40 17 34C17 29 20 24 24 18Z" fill="url(#fireInner)" />
                    {fireOn ? <circle cx="24" cy="50" r="3" fill="#7f1d1d" opacity="0.35" /> : null}
                  </svg>
                </div>
              </div>
            </div>
          </div>
            </div>
          </div>

          <div className="quad-section">
            <FieldCard data={state.f1} title="Field 1" fieldKey="f1" />
          </div>

          <div className="quad-section">
            <FieldCard data={state.f2} title="Field 2" fieldKey="f2" />
          </div>

          <div className="quad-section">
            <FieldCard data={state.f3} title="Field 3" fieldKey="f3" />
          </div>
        </div>
        </div>
      </div>
    </div>
  );
};

export default AgricultureDashboard;
