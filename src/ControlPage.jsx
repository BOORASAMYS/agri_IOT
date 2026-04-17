import React from 'react';

const PH_TARGET = 7;
const getPhChemicalState = (ph) => ({
  acid: ph < PH_TARGET,
  base: ph > PH_TARGET,
});

const DEFAULT_VALUES = {
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
  f2Base: true,
  f3Moisture: 24,
  f3Ph: 3.2,
  f3Wl: 8.5,
  f3N: 22,
  f3P: 18,
  f3K: 31,
  f3Irrigation: true,
  f3Drain: false,
  f3Acid: true,
  f3Base: false,
};

const FIELD_CONFIGS = [
  {
    title: 'Field 1 Controls',
    moistureKey: 'f1Moisture',
    phKey: 'f1Ph',
    nKey: 'f1N',
    pKey: 'f1P',
    kKey: 'f1K',
  },
  {
    title: 'Field 2 Controls',
    moistureKey: 'f2Moisture',
    phKey: 'f2Ph',
    nKey: 'f2N',
    pKey: 'f2P',
    kKey: 'f2K',
  },
  {
    title: 'Field 3 Controls',
    moistureKey: 'f3Moisture',
    phKey: 'f3Ph',
    nKey: 'f3N',
    pKey: 'f3P',
    kKey: 'f3K',
  },
];

const SliderControl = ({ label, value, min, max, step, onChange, formatter, accentClass = '' }) => {
  const handleSliderInput = (event) => onChange(event.target.value);

  return (
    <div className="control-block">
      <div className="control-row">
        <span className="control-label">{label}</span>
        <span className="control-value">{formatter(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onInput={handleSliderInput}
        onChange={handleSliderInput}
        className={`range-slider ${accentClass}`.trim()}
      />
    </div>
  );
};

const ToggleControl = ({ label, checked, onChange, tone = 'teal' }) => (
  <label className="toggle-row">
    <span className="toggle-copy">
      <span className="toggle-label">{label}</span>
      <span className="toggle-state">{checked ? 'ON' : 'OFF'}</span>
    </span>
    <button
      type="button"
      className={`toggle-btn ${checked ? 'on' : ''} ${tone}`.trim()}
      aria-pressed={checked}
      onClick={onChange}
    >
      <span className="toggle-knob"></span>
    </button>
  </label>
);

const ControlCard = ({ title, icon, children, accentClass = '' }) => (
  <section className={`control-card ${accentClass}`.trim()}>
    <div className="card-head">
      <div className="card-title">
        {icon ? <span className="card-icon" aria-hidden="true">{icon}</span> : null}
        {title}
      </div>
    </div>
    <div className="card-body">
      {children}
    </div>
  </section>
);

const ControlPage = ({ controlValues = {}, setControlValues = () => {} }) => {
  const values = { ...DEFAULT_VALUES, ...controlValues };

  const handleSliderChange = (key, value) => {
    const numericValue = parseFloat(value);
    setControlValues((prev) => {
      const next = {
        ...prev,
        [key]: numericValue,
      };

      if (key === 'f1Ph') {
        Object.assign(next, { f1Ph: numericValue, f1Acid: getPhChemicalState(numericValue).acid, f1Base: getPhChemicalState(numericValue).base });
      } else if (key === 'f2Ph') {
        Object.assign(next, { f2Ph: numericValue, f2Acid: getPhChemicalState(numericValue).acid, f2Base: getPhChemicalState(numericValue).base });
      } else if (key === 'f3Ph') {
        Object.assign(next, { f3Ph: numericValue, f3Acid: getPhChemicalState(numericValue).acid, f3Base: getPhChemicalState(numericValue).base });
      }

      return next;
    });
  };

  const handleToggleChange = (key) => {
    setControlValues((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? DEFAULT_VALUES[key]),
    }));
  };

  const handleResetSystem = () => {
    setControlValues(DEFAULT_VALUES);
  };

  return (
    <div className="control-page">
      <style>{`
        .control-page {
          width: 100%;
          background: #ffffff;
          padding: 0;
          font-size: 18px;
          height: 100%;
          min-height: 100%;
          overflow-y: auto;
        }

        .control-shell {
          width: 100%;
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 12px;
          min-height: 100%;
          align-content: stretch;
        }

        .control-button {
          border: none;
          border-radius: 10px;
          padding: 9px 12px;
          font-size: 18px;
          font-weight: 800;
          cursor: pointer;
          transition: background 0.2s ease, transform 0.2s ease;
        }

        .control-button:hover {
          transform: translateY(-1px);
        }

        .control-button.primary {
          background: #0d9488;
          color: #ffffff;
        }

        .control-button.secondary {
          background: #e6fffb;
          color: #0f766e;
          border: 1px solid #99f6e4;
        }

        .control-card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 13px 14px;
          box-shadow: 0 1px 6px rgba(0,0,0,0.06);
          min-width: 0;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .card-body {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .card-head {
          margin-bottom: 12px;
        }

        .card-title {
          font-size: 22px;
          font-weight: 700;
          color: #0f766e;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .card-icon {
          width: 24px;
          height: 24px;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #ecfeff;
          border: 1px solid #bae6fd;
          font-size: 18px;
          line-height: 1;
          flex-shrink: 0;
        }

        .control-stack {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .water-card .control-stack {
          flex: 1;
          justify-content: space-between;
        }

        .greenhouse-card .control-stack {
          flex: 1;
          justify-content: space-evenly;
        }

        .control-block {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .control-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
        }

        .control-label {
          font-size: 18px;
          font-weight: 600;
          color: #334155;
        }

        .control-value {
          font-size: 18px;
          font-weight: 700;
          color: #0f766e;
        }

        .range-slider {
          width: 100%;
          height: 4px;
          border-radius: 2px;
          background: #e2e8f0;
          outline: none;
          -webkit-appearance: none;
          cursor: pointer;
          touch-action: pan-x;
          -webkit-user-select: none;
          user-select: none;
        }

        .range-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #0d9488;
          box-shadow: 0 2px 4px rgba(13,148,136,0.3);
        }

        .range-slider::-moz-range-thumb {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #0d9488;
          border: none;
          box-shadow: 0 2px 4px rgba(13,148,136,0.3);
        }

        .range-slider.blue::-webkit-slider-thumb { background: #0284c7; }
        .range-slider.orange::-webkit-slider-thumb { background: #ea580c; }
        .range-slider.red::-webkit-slider-thumb { background: #dc2626; }
        .range-slider.blue::-moz-range-thumb { background: #0284c7; }
        .range-slider.orange::-moz-range-thumb { background: #ea580c; }
        .range-slider.red::-moz-range-thumb { background: #dc2626; }

        .toggle-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
        }

        .toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 8px 10px;
          border-radius: 10px;
          background: #f8fafc;
          border: 1px solid #e2e8f0;
        }

        .toggle-copy {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }

        .toggle-label {
          font-size: 18px;
          font-weight: 700;
          color: #334155;
        }

        .toggle-state {
          font-size: 18px;
          font-weight: 800;
          letter-spacing: 0.08em;
          color: #64748b;
        }

        .toggle-btn {
          width: 42px;
          height: 24px;
          border: none;
          border-radius: 999px;
          position: relative;
          background: #cbd5e1;
          cursor: pointer;
          transition: background 0.2s ease;
          flex-shrink: 0;
        }

        .toggle-btn.on.teal { background: #14b8a6; }
        .toggle-btn.on.blue { background: #0ea5e9; }
        .toggle-btn.on.amber { background: #f59e0b; }
        .toggle-btn.on.red { background: #ef4444; }

        .toggle-knob {
          position: absolute;
          top: 3px;
          left: 3px;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #ffffff;
          transition: transform 0.2s ease;
          box-shadow: 0 2px 6px rgba(15, 23, 42, 0.2);
        }

        .toggle-btn.on .toggle-knob {
          transform: translateX(18px);
        }

        .action-stack {
          display: flex;
          flex-direction: column;
          gap: 10px;
          flex: 1;
          justify-content: space-between;
        }

        .action-card .control-button {
          flex: 1;
        }

        .inline-action {
          margin-top: 4px;
        }

        @media screen and (max-width: 1200px) {
          .control-shell {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
        }

        @media screen and (max-width: 760px) {
          .control-shell {
            grid-template-columns: 1fr;
          }
        }
      `}</style>

      <div className="control-shell">
        <ControlCard
          title="Water System"
          icon="💧"
          accentClass="water-card"
        >
          <div className="control-stack">
            <ToggleControl
              label="Pump Operation"
              checked={values.pumping}
              onChange={() => handleToggleChange('pumping')}
              tone="blue"
            />

            <button type="button" className="control-button primary inline-action" onClick={handleResetSystem}>
              Reset System
            </button>
          </div>
        </ControlCard>

        <ControlCard
          title="Greenhouse"
          icon="🏡"
          accentClass="greenhouse-card"
        >
          <div className="control-stack">
            <SliderControl
              label="Temperature"
              value={values.temperature}
              min="20"
              max="60"
              step="0.1"
              onChange={(value) => handleSliderChange('temperature', value)}
              formatter={(value) => `${value.toFixed(1)} C`}
              accentClass="red"
            />

            <SliderControl
              label="Humidity"
              value={values.humidity}
              min="30"
              max="95"
              step="0.1"
              onChange={(value) => handleSliderChange('humidity', value)}
              formatter={(value) => `${value.toFixed(1)}%`}
            />
            <br />
          </div>
        </ControlCard>

        {FIELD_CONFIGS.map((field) => (
          <ControlCard
            key={field.title}
            title={field.title}
            icon={field.title.includes('1') ? '🌱' : field.title.includes('2') ? '🌿' : '🍃'}
            accentClass="field-card"
          >
            <div className="control-stack">
              <SliderControl
                label="Moisture"
                value={values[field.moistureKey]}
                min="0"
                max="100"
                step="0.1"
                onChange={(value) => handleSliderChange(field.moistureKey, value)}
                formatter={(value) => `${value.toFixed(1)}%`}
              />

              <SliderControl
                label="pH"
                value={values[field.phKey]}
                min="0"
                max="14"
                step="0.1"
                onChange={(value) => handleSliderChange(field.phKey, value)}
                formatter={(value) => value.toFixed(2)}
                accentClass="orange"
              />

              <SliderControl
                label="N"
                value={values[field.nKey]}
                min="0"
                max="100"
                step="1"
                onChange={(value) => handleSliderChange(field.nKey, value)}
                formatter={(value) => value.toFixed(0)}
              />

              <SliderControl
                label="P"
                value={values[field.pKey]}
                min="0"
                max="100"
                step="1"
                onChange={(value) => handleSliderChange(field.pKey, value)}
                formatter={(value) => value.toFixed(0)}
                accentClass="orange"
              />

              <SliderControl
                label="K"
                value={values[field.kKey]}
                min="0"
                max="100"
                step="1"
                onChange={(value) => handleSliderChange(field.kKey, value)}
                formatter={(value) => value.toFixed(0)}
              />
            </div>
          </ControlCard>
        ))}
      </div>
    </div>
  );
};

export default ControlPage;
