// import React, { useState, useEffect, useRef } from 'react';

// const AgricultureDashboard = () => {
//   // --- INITIAL STATE ---
//   const [state, setState] = useState({
//     tank: 41,
//     pumping: true,
//     flowRate: 2.4,
//     gh: { temp: 35, humidity: 65 },
//     f1: { moisture: 62.4, ph: 6.81, wl: 21.3, n: 42, p: 35, k: 55, irrigation: true, drain: true, acid: true, base: false },
//     f2: { moisture: 60.8, ph: 8.10, wl: 13.3, n: 38, p: 28, k: 48, irrigation: false, drain: false, acid: false, base: false },
//     f3: { moisture: 24, ph: 3.2, wl: 8.5, n: 22, p: 18, k: 31, irrigation: true, drain: false, acid: false, base: true },
//     time: new Date().toLocaleTimeString()
//   });

//   const stateRef = useRef(state);
//   useEffect(() => { stateRef.current = state; }, [state]);

//   // --- UTILS ---
//   const phColor = (ph) => {
//     if (ph < 4) return '#ef4444';
//     if (ph < 6) return '#f97316';
//     if (ph < 6.5) return '#eab308';
//     if (ph <= 7.5) return '#22c55e';
//     if (ph <= 9) return '#3b82f6';
//     return '#8b5cf6';
//   };

//   const moistureColor = (m) => {
//     if (m > 55) return '#22c55e';
//     if (m > 35) return '#eab308';
//     return '#ef4444';
//   };

//   // --- SIMULATION LOGIC ---
//   useEffect(() => {
//     const interval = setInterval(() => {
//       const s = JSON.parse(JSON.stringify(stateRef.current));

//       if (s.pumping && s.tank < 80) {
//         s.tank = Math.min(s.tank + 0.35 + Math.random() * 0.1, 80);
//         s.flowRate = 2.2 + Math.random() * 0.5;
//       } else if (s.tank >= 80) {
//         s.pumping = false;
//         s.flowRate = 0;
//       } else if (s.tank < 20) {
//         s.pumping = true;
//       }

//       ['f1', 'f2', 'f3'].forEach((id) => {
//         const f = s[id];
//         if (f.irrigation && f.moisture < 60) {
//           f.moisture = Math.min(f.moisture + 0.25 + Math.random() * 0.15, 60);
//         } else if (f.moisture >= 60) {
//           f.irrigation = false;
//           f.drain = true;
//         } else if (f.moisture < 30) {
//           f.irrigation = true;
//           f.drain = false;
//         }
//         f.moisture = Math.max(0, Math.min(100, f.moisture + (Math.random() - 0.5) * 0.3));
//         f.ph = Math.max(0, Math.min(14, f.ph + (Math.random() - 0.5) * 0.05));
//         f.wl = Math.max(0, Math.min(30, f.wl + (Math.random() - 0.5) * 0.2));
//       });

//       s.gh.temp = Math.max(20, Math.min(60, s.gh.temp + (Math.random() - 0.47) * 0.4));
//       s.gh.humidity = Math.max(30, Math.min(95, s.gh.humidity + (Math.random() - 0.5) * 0.6));
//       s.time = new Date().toLocaleTimeString();

//       setState(s);
//     }, 1400);

//     return () => clearInterval(interval);
//   }, []);

//   const remTime = Math.max(0, Math.round((80 - state.tank) / (state.flowRate || 1) * 25));
//   const fanOn = state.gh.temp > 40 || state.gh.humidity > 70;
//   const fireOn = state.gh.temp > 40;
//   const fanSpeedClass = state.gh.temp > 50 ? "spin-fast" : state.gh.temp > 44 ? "spin-med" : "spin-slow";

//   const StatusChip = ({ on, label }) => (
//     <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: on ? '#16a34a' : '#94a3b8' }}>
//       <span className="dot" style={{ background: on ? '#22c55e' : '#cbd5e1' }}></span>
//       {label}
//     </span>
//   );

//   const FieldCard = ({ data, title }) => {
//     const mc = moistureColor(data.moisture);
//     const phPct = (data.ph / 14 * 100).toFixed(1);
//     const wlPct = Math.min(data.wl / 30 * 100, 100);

//     return (
//       <div className="card">
//         <div className="ctitle">
//           <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/></svg>
//           {title}
//           <span className="dot" style={{ marginLeft: 'auto', background: data.irrigation ? '#22c55e' : '#cbd5e1' }}></span>
//           <span style={{ fontSize: '10px', color: data.irrigation ? '#16a34a' : '#94a3b8' }}>{data.irrigation ? 'Irrigating' : 'Idle'}</span>
//         </div>
//         <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', alignItems: 'start' }}>
//           <div className="col">
//             <svg width="64" height="38" viewBox="0 0 64 38">
//               <circle cx="32" cy="32" r="28" fill="none" stroke="#e2e8f0" strokeWidth="7" strokeDasharray="88 176"/>
//               <circle cx="32" cy="32" r="28" fill="none" stroke={mc} strokeWidth="7" strokeDasharray={`${(data.moisture / 100 * 88).toFixed(1)} 176`} strokeLinecap="round" className="gauge-arc" style={{ transform: 'rotate(180deg)', transformOrigin: '32px 32px' }}/>
//               <text x="32" y="35" textAnchor="middle" fontSize="10" fontWeight="500" fill="#1e293b">{data.moisture.toFixed(1)}%</text>
//             </svg>
//             <span className="lbl">Moisture</span>
//           </div>
//           <div className="col">
//             <div className="field-tank"><div className="field-fill" style={{ height: `${wlPct}%` }}></div></div>
//             <div className="val">{data.wl.toFixed(1)} cm</div>
//             <span className="lbl">Water</span>
//           </div>
//           <div className="col" style={{ width: '100%' }}>
//             <div style={{ width: '100%', fontSize: '9px', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}><span>0</span><span>7</span><span>14</span></div>
//             <div className="ph-track"><div className="ph-dot" style={{ left: `${phPct}%` }}></div></div>
//             <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: '500', color: phColor(data.ph) }}>pH {data.ph.toFixed(2)}</div>
//             <span className="lbl">pH</span>
//           </div>
//         </div>
//         <div style={{ marginTop: '8px' }}>
//           <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
//             {[ {l:'N', v:data.n, c:'#22c55e'}, {l:'P', v:data.p, c:'#f59e0b'}, {l:'K', v:data.k, c:'#8b5cf6'} ].map(item => (
//                <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px' }}>
//                  <span style={{ color: item.c, fontWeight: 500, width: '9px' }}>{item.l}</span>
//                  <div className="npk-track"><div className="npk-fill" style={{ width: `${item.v}%`, background: item.c }}></div></div>
//                  <span style={{ color: '#64748b', width: '22px', textAlign: 'right' }}>{item.v}</span>
//                </div>
//             ))}
//           </div>
//         </div>
//         <div style={{ marginTop: '8px', paddingTop: '7px', borderTop: '0.5px solid #f1f5f9', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
//           <StatusChip on={data.irrigation} label="Irrigation" />
//           <StatusChip on={data.drain} label="Drain" />
//           <StatusChip on={data.acid} label="Acid" />
//           <StatusChip on={data.base} label="Base" />
//         </div>
//       </div>
//     );
//   };

//   return (
//     <div className="dash-container">
//       <style>{`
//         * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
        
//         /* Forces the app to occupy full screen and prevents bottom gaps on zoom */
//         body, html, #root { 
//           height: 100%; 
//           width: 100%; 
//           background: #f8fafc; 
//         }

//         .dash-container { 
//           display: flex;
//           flex-direction: column;
//           justify-content: flex-start;
//           align-items: center;
//           width: 100%;
//           min-height: 100vh;
//           background: #ffffff;
//           padding: 14px;
//         }

//         .dash { 
//           width: 1280px; /* Optimized for the requested width */
//           margin: 0 auto;
//         }

//         .header { background: #0d9488; color: white; padding: 11px 18px; border-radius: 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(13,148,136,0.18); }
//         .grid1 { display: grid; grid-template-columns: 320px minmax(0, 1fr) minmax(0, 1fr); gap: 12px; margin-bottom: 12px; }
//         .grid2 { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
//         .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06); }
//         .ctitle { font-size: 12px; font-weight: 500; color: #0d9488; margin-bottom: 11px; display: flex; align-items: center; gap: 6px; }
//         .lbl { font-size: 10px; color: #94a3b8; text-align: center; margin-top: 3px; }
//         .val { font-size: 12px; font-weight: 500; color: #1e293b; text-align: center; }
//         .col { display: flex; flex-direction: column; align-items: center; gap: 3px; }
//         .row { display: flex; align-items: center; gap: 8px; }
//         .badge { font-size: 10px; padding: 2px 8px; border-radius: 20px; font-weight: 500; display: inline-block; }
//         .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
//         .stat-row { display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 4px 0; border-bottom: 0.5px solid #f1f5f9; }
        
//         @keyframes spin { to { transform: rotate(360deg); } }
//         @keyframes flow { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
//         @keyframes blink { 50% { opacity: 0.15; } }
        
//         .spin-slow { animation: spin 2.5s linear infinite; }
//         .spin-med { animation: spin 1s linear infinite; }
//         .spin-fast { animation: spin 0.35s linear infinite; }
//         .spin-stop { }

//         .pipe { position: relative; overflow: hidden; border-radius: 3px; background: #bae6fd; height: 5px; width: 22px; }
//         .pipe-flow { position: absolute; top: 0; left: 0; width: 35%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent); animation: flow 1.2s linear infinite; }
//         .pipe-stopped { background: #e2e8f0; }
//         .pipe-stopped .pipe-flow { display: none; }

//         .tank-outer { border: 2px solid #94a3b8; border-radius: 5px; background: #f8fafc; overflow: hidden; position: relative; }
//         .tank-inner { width: 100%; background: #38bdf8; position: absolute; bottom: 0; transition: height 1.2s cubic-bezier(0.4, 0, 0.2, 1); }
//         .field-tank { width: 26px; height: 56px; border: 1.5px solid #94a3b8; border-radius: 4px; background: #f8fafc; overflow: hidden; position: relative; }
//         .field-fill { position: absolute; bottom: 0; width: 100%; background: #38bdf8; transition: height 1s ease; }
//         .ph-track { width: 100%; height: 8px; border-radius: 4px; background: linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6); position: relative; margin: 4px 0; }
//         .ph-dot { width: 11px; height: 11px; background: #1e293b; border-radius: 50%; position: absolute; top: -1.5px; transform: translateX(-50%); transition: left 1s cubic-bezier(0.4, 0, 0.2, 1); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
//         .gauge-arc { fill: none; stroke-linecap: round; transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1); }
//         .npk-track { flex: 1; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden; }
//         .npk-fill { height: 100%; border-radius: 2px; transition: width 1s ease; }
//         .thermo-tube { width: 9px; height: 36px; border: 1.5px solid #94a3b8; border-radius: 5px; background: #f8fafc; overflow: hidden; position: relative; }
//         .thermo-fill { position: absolute; bottom: 0; width: 100%; background: #ef4444; transition: height 1s ease; }

//         /* Handling zoom and smaller viewports */
//         @media screen and (max-width: 1280px) {
//           .dash { width: 100%; }
//         }
//       `}</style>

//       <div className="dash">
//         <div className="header">
//           <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
//           Agriculture IoT Dashboard
//           <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '5px' }}>
//             <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#86efac', display: 'inline-block' }}></span>
//             <span>Simulating</span>
//             <span style={{ opacity: 0.7 }}>{state.time}</span>
//           </span>
//         </div>

//         <div className="grid1">
//           <div className="card">
//             <div className="ctitle">
//               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/></svg>
//               Main Tank System
//             </div>
//             <div style={{ display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'center' }}>
//               <div className="col">
//                 <div style={{ width: '36px', height: '36px', border: '2px solid #64748b', borderRadius: '6px', background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
//                   <svg width="22" height="18" viewBox="0 0 24 20" fill="none" stroke="#7dd3fc" strokeWidth="1.5"><rect x="1" y="6" width="22" height="13" rx="2"/><path d="M5 6Q8 1 12 1Q16 1 19 6"/><path d="M4 13Q8 11 12 13Q16 15 20 13" opacity="0.5"/></svg>
//                 </div>
//                 <span className="lbl">Reservoir</span>
//               </div>
//               <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className="pipe-flow"></div></div>
//               <div className="col">
//                 <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: '2px solid #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', background: state.pumping ? '#e0f2fe' : '#fef2f2', transition: 'background 0.8s' }}>
//                   <svg width="18" height="18" viewBox="0 0 36 36" className={state.pumping ? 'spin-med' : 'spin-stop'}>
//                     <path d="M18 18C18 10 26 6 28 12C30 18 24 20 18 18Z" fill={state.pumping ? '#0ea5e9' : '#f87171'} opacity="0.9"/>
//                     <path d="M18 18C26 18 30 26 24 28C18 30 16 24 18 18Z" fill={state.pumping ? '#0ea5e9' : '#f87171'} opacity="0.9"/>
//                     <path d="M18 18C18 26 10 30 8 24C6 18 12 16 18 18Z" fill={state.pumping ? '#0ea5e9' : '#f87171'} opacity="0.9"/>
//                     <path d="M18 18C10 18 6 10 12 8C18 6 20 12 18 18Z" fill={state.pumping ? '#0ea5e9' : '#f87171'} opacity="0.9"/>
//                     <circle cx="18" cy="18" r="4" fill={state.pumping ? '#0369a1' : '#b91c1c'}/>
//                   </svg>
//                 </div>
//                 <span className="lbl">Pump</span>
//               </div>
//               <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className="pipe-flow"></div></div>
//               <div className="col">
//                 <div className="tank-outer" style={{ width: '40px', height: '76px' }}>
//                   <div className="tank-inner" style={{ height: `${state.tank.toFixed(1)}%` }}></div>
//                   <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
//                     <span style={{ fontSize: '10px', fontWeight: 500, color: '#0369a1', textShadow: '0 0 4px white' }}>{Math.round(state.tank)}%</span>
//                   </div>
//                 </div>
//                 <span className="lbl">Tank</span>
//               </div>
//             </div>
//             <div style={{ marginTop: '14px', borderTop: '0.5px solid #f1f5f9', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
//               <div className="stat-row"><span style={{ color: '#64748b' }}>Flow rate</span><span style={{ fontWeight: 500, color: '#0369a1' }}>{state.flowRate.toFixed(1)} L/min</span></div>
//               <div className="stat-row"><span style={{ color: '#64748b' }}>Fill time</span><span style={{ fontWeight: 500, color: '#0369a1' }}>{state.pumping ? (remTime > 0 ? `~${remTime}s` : 'Full') : 'Stopped'}</span></div>
//               <div className="stat-row" style={{ border: 'none' }}><span style={{ color: '#64748b' }}>Pump status</span><span className="badge" style={{ background: state.pumping ? '#dbeafe' : '#f1f5f9', color: state.pumping ? '#1e40af' : '#475569' }}>{state.pumping ? 'Active' : 'Idle'}</span></div>
//             </div>
//           </div>

//           <div className="card">
//             <div className="ctitle">
//               <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
//               Greenhouse
//             </div>
//             <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
//               <div className="col" style={{ gap: '5px' }}>
//                 <div style={{ width: '52px', height: '52px', border: '1.5px solid #e2e8f0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
//                   <svg width="34" height="34" viewBox="0 0 36 36" className={fanOn ? fanSpeedClass : 'spin-stop'}>
//                     <path d="M18 18C18 10 26 6 28 12C30 18 24 20 18 18Z" fill="#0d9488" opacity="0.85"/>
//                     <path d="M18 18C26 18 30 26 24 28C18 30 16 24 18 18Z" fill="#0d9488" opacity="0.85"/>
//                     <path d="M18 18C18 26 10 30 8 24C6 18 12 16 18 18Z" fill="#0d9488" opacity="0.85"/>
//                     <path d="M18 18C10 18 6 10 12 8C18 6 20 12 18 18Z" fill="#0d9488" opacity="0.85"/>
//                     <circle cx="18" cy="18" r="3.5" fill="#134e4a"/>
//                   </svg>
//                 </div>
//                 <span className="lbl">Fan</span>
//                 <span className="badge" style={{ background: fanOn ? '#dcfce7' : '#f1f5f9', color: fanOn ? '#15803d' : '#475569' }}>{fanOn ? 'ON' : 'OFF'}</span>
//               </div>
//               <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
//                 <div className="row">
//                   <div className="thermo-tube"><div className="thermo-fill" style={{ height: `${Math.min((state.gh.temp / 60) * 100, 100)}%` }}></div></div>
//                   <div>
//                     <div style={{ fontSize: '16px', fontWeight: 500, color: state.gh.temp > 40 ? '#dc2626' : '#ea580c' }}>{state.gh.temp.toFixed(1)}°C</div>
//                     <div style={{ fontSize: '10px', color: '#94a3b8' }}>Temperature</div>
//                   </div>
//                 </div>
//                 <div className="row">
//                   <svg width="14" height="18" viewBox="0 0 14 20"><path d="M7 1Q11 7 11 12A4 4 0 0 1 3 12Q3 7 7 1Z" fill="#38bdf8"/></svg>
//                   <div>
//                     <div style={{ fontSize: '16px', fontWeight: 500, color: '#0ea5e9' }}>{Math.round(state.gh.humidity)}%</div>
//                     <div style={{ fontSize: '10px', color: '#94a3b8' }}>Humidity</div>
//                   </div>
//                 </div>
//               </div>
//               <div className="col" style={{ gridColumn: '1/-1', borderTop: '0.5px solid #f1f5f9', paddingTop: '8px' }}>
//                 <div style={{ display: 'flex', alignItems: 'center', gap: '8px', animation: fireOn ? 'blink 0.8s step-end infinite' : 'none' }}>
//                   <svg width="20" height="24" viewBox="0 0 20 26">
//                     <path d="M10 1Q15 8 15 15A5 5 0 0 1 5 15Q5 8 10 1Z" fill={fireOn ? '#ef4444' : '#94a3b8'}/>
//                     <path d="M10 12Q13 15 13 18A3 3 0 0 1 7 18Q7 15 10 12Z" fill={fireOn ? '#fbbf24' : '#e2e8f0'}/>
//                   </svg>
//                   <div>
//                     <div style={{ fontSize: '12px', fontWeight: 500, color: fireOn ? '#dc2626' : '#16a34a' }}>{fireOn ? 'Fire Detected!' : 'Safe'}</div>
//                     <div style={{ fontSize: '10px', color: '#94a3b8' }}>Fire Alert</div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </div>

//           <FieldCard data={state.f1} title="Field 1" />
//         </div>

//         <div className="grid2">
//           <FieldCard data={state.f2} title="Field 2" />
//           <FieldCard data={state.f3} title="Field 3" />
          
//           <div className="card">
//             <div className="ctitle">
//               <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>
//               System Status
//             </div>
//             <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
//               {[
//                 {l:'Main tank', v:Math.round(state.tank)+'%', c:state.tank>50?'#16a34a':state.tank>20?'#d97706':'#dc2626'},
//                 {l:'Pump', v:state.pumping?'Running':'Idle', c:state.pumping?'#16a34a':'#94a3b8'},
//                 {l:'GH Temp', v:state.gh.temp.toFixed(1)+'°C', c:state.gh.temp>40?'#dc2626':'#16a34a'},
//                 {l:'GH Humidity', v:Math.round(state.gh.humidity)+'%', c:state.gh.humidity>70?'#d97706':'#16a34a'},
//                 {l:'Field 1', v:state.f1.irrigation?'Irrigating':'Idle', c:state.f1.irrigation?'#0369a1':'#94a3b8'},
//                 {l:'Field 2', v:state.f2.irrigation?'Irrigating':'Idle', c:state.f2.irrigation?'#0369a1':'#94a3b8'},
//                 {l:'Field 3', v:state.f3.irrigation?'Irrigating':'Idle', c:state.f3.irrigation?'#0369a1':'#94a3b8'},
//               ].map((r, i) => (
//                 <div key={i} className="stat-row">
//                   <span style={{ color: '#64748b', fontSize: '11px' }}>{r.l}</span>
//                   <span style={{ fontSize: '11px', fontWeight: 500, color: r.c }}>{r.v}</span>
//                 </div>
//               ))}
//             </div>
//           </div>
//         </div>
//       </div>
//     </div>
//   );
// };

// export default AgricultureDashboard;















import React, { useState, useEffect, useRef } from 'react';

const AgricultureDashboard = () => {
  // --- INITIAL STATE (DO NOT CHANGE) ---
  const [state, setState] = useState({
    tank: 41,
    pumping: true,
    flowRate: 2.4,
    gh: { temp: 35, humidity: 65 },
    f1: { moisture: 62.4, ph: 6.81, wl: 21.3, n: 42, p: 35, k: 55, irrigation: true, drain: true, acid: true, base: false },
    f2: { moisture: 60.8, ph: 8.10, wl: 13.3, n: 38, p: 28, k: 48, irrigation: false, drain: false, acid: false, base: false },
    f3: { moisture: 24, ph: 3.2, wl: 8.5, n: 22, p: 18, k: 31, irrigation: true, drain: false, acid: false, base: true },
    time: new Date().toLocaleTimeString()
  });

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  // --- UTILS ---
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

  // --- SIMULATION LOGIC (DO NOT CHANGE) ---
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

  const StatusChip = ({ on, label }) => (
    <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '10px', color: on ? '#16a34a' : '#94a3b8' }}>
      <span className="dot" style={{ background: on ? '#22c55e' : '#cbd5e1' }}></span>
      {label}
    </span>
  );

  const FieldCard = ({ data, title }) => {
    const mc = moistureColor(data.moisture);
    const phPct = (data.ph / 14 * 100).toFixed(1);
    const wlPct = Math.min(data.wl / 30 * 100, 100);

    return (
      <div className="card">
        <div className="ctitle">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="14" rx="2"/></svg>
          {title}
          <span className="dot" style={{ marginLeft: 'auto', background: data.irrigation ? '#22c55e' : '#cbd5e1' }}></span>
          <span style={{ fontSize: '10px', color: data.irrigation ? '#16a34a' : '#94a3b8' }}>{data.irrigation ? 'Irrigating' : 'Idle'}</span>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', alignItems: 'start' }}>
          <div className="col">
            <svg width="64" height="38" viewBox="0 0 64 38">
              <circle cx="32" cy="32" r="28" fill="none" stroke="#e2e8f0" strokeWidth="7" strokeDasharray="88 176"/>
              <circle cx="32" cy="32" r="28" fill="none" stroke={mc} strokeWidth="7" strokeDasharray={`${(data.moisture / 100 * 88).toFixed(1)} 176`} strokeLinecap="round" className="gauge-arc" style={{ transform: 'rotate(180deg)', transformOrigin: '32px 32px' }}/>
              <text x="32" y="35" textAnchor="middle" fontSize="10" fontWeight="500" fill="#1e293b">{data.moisture.toFixed(1)}%</text>
            </svg>
            <span className="lbl">Moisture</span>
          </div>
          <div className="col">
            <div className="field-tank"><div className="field-fill" style={{ height: `${wlPct}%` }}></div></div>
            <div className="val">{data.wl.toFixed(1)} cm</div>
            <span className="lbl">Water</span>
          </div>
          <div className="col" style={{ width: '100%' }}>
            <div style={{ width: '100%', fontSize: '9px', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}><span>0</span><span>7</span><span>14</span></div>
            <div className="ph-track"><div className="ph-dot" style={{ left: `${phPct}%` }}></div></div>
            <div style={{ textAlign: 'center', fontSize: '11px', fontWeight: '500', color: phColor(data.ph) }}>pH {data.ph.toFixed(2)}</div>
            <span className="lbl">pH</span>
          </div>
        </div>
        <div style={{ marginTop: '8px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            {[ {l:'N', v:data.n, c:'#22c55e'}, {l:'P', v:data.p, c:'#f59e0b'}, {l:'K', v:data.k, c:'#8b5cf6'} ].map(item => (
               <div key={item.l} style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '10px' }}>
                 <span style={{ color: item.c, fontWeight: 500, width: '9px' }}>{item.l}</span>
                 <div className="npk-track"><div className="npk-fill" style={{ width: `${item.v}%`, background: item.c }}></div></div>
                 <span style={{ color: '#64748b', width: '22px', textAlign: 'right' }}>{item.v}</span>
               </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: '8px', paddingTop: '7px', borderTop: '0.5px solid #f1f5f9', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <StatusChip on={data.irrigation} label="Irrigation" />
          <StatusChip on={data.drain} label="Drain" />
          <StatusChip on={data.acid} label="Acid" />
          <StatusChip on={data.base} label="Base" />
        </div>
      </div>
    );
  };

  return (
    <div className="dash-container">
      <style>{`
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: system-ui, sans-serif; }
        body, html, #root { height: 100%; width: 100%; background: #ffffff; }
        .dash-container { display: flex; flex-direction: column; align-items: center; width: 100%; min-height: 100vh; padding: 14px; }
        .dash { width: 1280px; margin: 0 auto; }
        .header { background: #0d9488; color: white; padding: 11px 18px; border-radius: 12px; margin-bottom: 12px; display: flex; align-items: center; gap: 10px; font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(13,148,136,0.18); }
        
        /* Layout Updates */
        .grid-top { display: grid; grid-template-columns: 2fr 1fr; gap: 12px; margin-bottom: 12px; }
        .grid-bottom { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; }
        
        .card { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; box-shadow: 0 1px 6px rgba(0,0,0,0.06); height: 100%; }
        .ctitle { font-size: 12px; font-weight: 500; color: #0d9488; margin-bottom: 11px; display: flex; align-items: center; gap: 6px; }
        .lbl { font-size: 10px; color: #94a3b8; text-align: center; margin-top: 3px; }
        .val { font-size: 12px; font-weight: 500; color: #1e293b; text-align: center; }
        .col { display: flex; flex-direction: column; align-items: center; gap: 3px; }
        .row { display: flex; align-items: center; gap: 8px; }
        .badge { font-size: 9px; padding: 1px 6px; border-radius: 20px; font-weight: 500; display: inline-block; }
        .dot { width: 7px; height: 7px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
        .stat-row { display: flex; align-items: center; justify-content: space-between; font-size: 11px; padding: 4px 0; border-bottom: 0.5px solid #f1f5f9; }
        
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes flow { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
        @keyframes blink { 50% { opacity: 0.15; } }
        
        .spin-slow { animation: spin 2.5s linear infinite; }
        .spin-med { animation: spin 1s linear infinite; }
        .spin-fast { animation: spin 0.35s linear infinite; }

        /* Pipe Styling */
        .pipe { position: relative; overflow: hidden; border-radius: 3px; background: #bae6fd; height: 6px; width: 60px; }
        .pipe-flow { position: absolute; top: 0; left: 0; width: 35%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent); animation: flow 1.2s linear infinite; }
        .pipe-stopped { background: #e2e8f0; }
        .pipe-stopped .pipe-flow { display: none; }

        /* Tank and Scale Styling */
        .tank-wrapper { position: relative; display: flex; align-items: flex-end; gap: 8px; }
        .tank-outer { border: 2.5px solid #64748b; border-radius: 6px; background: #f1f5f9; overflow: hidden; position: relative; box-shadow: inset 0 2px 4px rgba(0,0,0,0.05); }
        .tank-inner { width: 100%; background: linear-gradient(180deg, #38bdf8 0%, #0ea5e9 100%); position: absolute; bottom: 0; transition: height 1.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .tank-scale { height: 100%; display: flex; flex-direction: column; justify-content: space-between; padding: 2px 0; }
        .scale-mark { display: flex; align-items: center; gap: 4px; font-size: 9px; color: #94a3b8; font-weight: 500; }
        .scale-line { width: 6px; height: 1px; background: #cbd5e1; }

        .field-tank { width: 26px; height: 56px; border: 1.5px solid #94a3b8; border-radius: 4px; background: #f8fafc; overflow: hidden; position: relative; }
        .field-fill { position: absolute; bottom: 0; width: 100%; background: #38bdf8; transition: height 1s ease; }
        .ph-track { width: 100%; height: 8px; border-radius: 4px; background: linear-gradient(to right, #ef4444, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6); position: relative; margin: 4px 0; }
        .ph-dot { width: 11px; height: 11px; background: #1e293b; border-radius: 50%; position: absolute; top: -1.5px; transform: translateX(-50%); transition: left 1s cubic-bezier(0.4, 0, 0.2, 1); border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.3); }
        .gauge-arc { fill: none; stroke-linecap: round; transition: stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1); }
        .npk-track { flex: 1; height: 4px; background: #e2e8f0; border-radius: 2px; overflow: hidden; }
        .npk-fill { height: 100%; border-radius: 2px; transition: width 1s ease; }
        .thermo-tube { width: 7px; height: 30px; border: 1.2px solid #94a3b8; border-radius: 4px; background: #f8fafc; overflow: hidden; position: relative; }
        .thermo-fill { position: absolute; bottom: 0; width: 100%; background: #ef4444; transition: height 1s ease; }

        @media screen and (max-width: 1280px) { .dash { width: 100%; } }
      `}</style>

      <div className="dash">
        <div className="header">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Agriculture IoT Dashboard
          <span style={{ marginLeft: 'auto', fontSize: '10px', opacity: 0.8, display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#86efac', display: 'inline-block' }}></span>
            <span>Simulating</span>
            <span style={{ opacity: 0.7 }}>{state.time}</span>
          </span>
        </div>

        {/* Top Section: Main Tank (Wide) and Greenhouse (Compact) */}
        <div className="grid-top">
          <div className="card">
            <div className="ctitle">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/></svg>
              Main Tank System
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px', justifyContent: 'center', padding: '10px 0' }}>
              <div className="col">
                <div style={{ width: '48px', height: '48px', border: '2px solid #64748b', borderRadius: '8px', background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <svg width="28" height="24" viewBox="0 0 24 20" fill="none" stroke="#7dd3fc" strokeWidth="1.5"><rect x="1" y="6" width="22" height="13" rx="2"/><path d="M5 6Q8 1 12 1Q16 1 19 6"/><path d="M4 13Q8 11 12 13Q16 15 20 13" opacity="0.5"/></svg>
                </div>
                <span className="lbl">Reservoir</span>
              </div>

              <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className="pipe-flow"></div></div>

              <div className="col">
                <div style={{ width: '44px', height: '44px', borderRadius: '50%', border: '2.5px solid #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', background: state.pumping ? '#e0f2fe' : '#fef2f2' }}>
                  <svg width="28" height="28" viewBox="0 0 36 36" className={state.pumping ? 'spin-med' : ''}>
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
                <div className="tank-wrapper">
                   {/* Tank Scale */}
                   <div className="tank-scale">
                      <div className="scale-mark"><span>100</span><div className="scale-line"></div></div>
                      <div className="scale-mark"><span>75</span><div className="scale-line"></div></div>
                      <div className="scale-mark"><span>50</span><div className="scale-line"></div></div>
                      <div className="scale-mark"><span>25</span><div className="scale-line"></div></div>
                      <div className="scale-mark"><span>0</span><div className="scale-line"></div></div>
                   </div>
                   <div className="tank-outer" style={{ width: '54px', height: '110px' }}>
                    <div className="tank-inner" style={{ height: `${state.tank.toFixed(1)}%` }}></div>
                    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontSize: '12px', fontWeight: 700, color: '#0369a1', textShadow: '0 0 4px white' }}>{Math.round(state.tank)}%</span>
                    </div>
                  </div>
                </div>
                <span className="lbl">Main Storage</span>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '15px', marginTop: '10px', borderTop: '0.5px solid #f1f5f9', paddingTop: '10px' }}>
              <div className="stat-row" style={{border:'none'}}><span style={{ color: '#64748b' }}>Flow rate:</span><span style={{ fontWeight: 600, color: '#0369a1' }}>{state.flowRate.toFixed(1)} L/min</span></div>
              <div className="stat-row" style={{border:'none'}}><span style={{ color: '#64748b' }}>Time to fill:</span><span style={{ fontWeight: 600, color: '#0369a1' }}>{state.pumping ? (remTime > 0 ? `~${remTime}s` : 'Full') : 'N/A'}</span></div>
              <div className="stat-row" style={{border:'none'}}><span style={{ color: '#64748b' }}>Status:</span><span className="badge" style={{ background: state.pumping ? '#dbeafe' : '#f1f5f9', color: state.pumping ? '#1e40af' : '#475569' }}>{state.pumping ? 'PUMPING' : 'IDLE'}</span></div>
            </div>
          </div>

          <div className="card" style={{ padding: '12px' }}>
            <div className="ctitle" style={{ marginBottom: '8px' }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/></svg>
              Greenhouse
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div className="col" style={{ gap: '3px' }}>
                <div style={{ width: '42px', height: '42px', border: '1.5px solid #e2e8f0', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc' }}>
                  <svg width="26" height="26" viewBox="0 0 36 36" className={fanOn ? fanSpeedClass : ''}>
                    <path d="M18 18C18 10 26 6 28 12C30 18 24 20 18 18Z" fill="#0d9488" opacity="0.85"/>
                    <path d="M18 18C26 18 30 26 24 28C18 30 16 24 18 18Z" fill="#0d9488" opacity="0.85"/>
                    <path d="M18 18C18 26 10 30 8 24C6 18 12 16 18 18Z" fill="#0d9488" opacity="0.85"/>
                    <path d="M18 18C10 18 6 10 12 8C18 6 20 12 18 18Z" fill="#0d9488" opacity="0.85"/>
                    <circle cx="18" cy="18" r="3.5" fill="#134e4a"/>
                  </svg>
                </div>
                <span className="badge" style={{ background: fanOn ? '#dcfce7' : '#f1f5f9', color: fanOn ? '#15803d' : '#475569' }}>FAN {fanOn ? 'ON' : 'OFF'}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', justifyContent: 'center' }}>
                <div className="row" style={{ gap: '5px' }}>
                  <div className="thermo-tube"><div className="thermo-fill" style={{ height: `${Math.min((state.gh.temp / 60) * 100, 100)}%` }}></div></div>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: state.gh.temp > 40 ? '#dc2626' : '#ea580c' }}>{state.gh.temp.toFixed(1)}°C</div>
                    <div style={{ fontSize: '9px', color: '#94a3b8' }}>Temp</div>
                  </div>
                </div>
                <div className="row" style={{ gap: '5px' }}>
                  <svg width="12" height="15" viewBox="0 0 14 20"><path d="M7 1Q11 7 11 12A4 4 0 0 1 3 12Q3 7 7 1Z" fill="#38bdf8"/></svg>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#0ea5e9' }}>{Math.round(state.gh.humidity)}%</div>
                    <div style={{ fontSize: '9px', color: '#94a3b8' }}>Humid</div>
                  </div>
                </div>
              </div>
              <div className="col" style={{ gridColumn: '1/-1', borderTop: '0.5px solid #f1f5f9', paddingTop: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', animation: fireOn ? 'blink 0.8s step-end infinite' : 'none' }}>
                  <svg width="16" height="20" viewBox="0 0 20 26">
                    <path d="M10 1Q15 8 15 15A5 5 0 0 1 5 15Q5 8 10 1Z" fill={fireOn ? '#ef4444' : '#22c55e'}/>
                  </svg>
                  <span style={{ fontSize: '11px', fontWeight: 600, color: fireOn ? '#dc2626' : '#16a34a' }}>{fireOn ? 'FIRE ALERT!' : 'SYSTEM SAFE'}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom Section: 3 Field Columns */}
        <div className="grid-bottom">
          <FieldCard data={state.f1} title="Field 1" />
          <FieldCard data={state.f2} title="Field 2" />
          <FieldCard data={state.f3} title="Field 3" />
        </div>
      </div>
    </div>
  );
};

export default AgricultureDashboard;