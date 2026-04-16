import React, { useState, useEffect, useRef } from 'react';
import cyberLancersLogo from './assets/CyberLancers_Logo.svg';
import cdacLogo from './assets/cdac-logo.svg';
import cyberMainSplash from './assets/Cyber_Main.png';

const API_BASE = '/api';
const FIELD_ENDPOINTS = {
  f1: `${API_BASE}/fields/f1`,
  f2: `${API_BASE}/fields/f2`,
  f3: `${API_BASE}/fields/f3`,
};
const GREENHOUSE_ENDPOINT = `${API_BASE}/greenhouse`;
const MAIN_TANK_ENDPOINT = `${API_BASE}/main-tank`;
const SHUTDOWN_ENDPOINT = `${API_BASE}/shutdown`;
const DRAG_COMMIT_INTERVAL_MS = 90;
const GREENHOUSE_FAN_TEMP_THRESHOLD = 40;
const GREENHOUSE_FAN_HUMIDITY_THRESHOLD = 70;
const MAIN_TANK_CAPACITY_ML = 500;
const MAIN_TANK_REFILL_START_PERCENT = 20;
const MAIN_TANK_FLOW_REDUCE_PERCENT = 80;
const MAIN_TANK_FILL_TIME_MINUTES = 2;
const MAIN_TANK_DRAIN_STEP_PERCENT = 2;
const MAIN_TANK_DRAIN_INTERVAL_MS = 1200;
const AUTOMATION_TICK_MS = 1200;
const IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD = 30;
const IRRIGATION_AUTO_OFF_MOISTURE_THRESHOLD = 60;
const MAIN_TANK_HIGH_FILL_PERCENT_PER_TICK = 2.0;
const MAIN_TANK_LOW_FILL_PERCENT_PER_TICK = 2.0;
const PH_TARGET = 7;
const PH_TARGET_TOLERANCE = 0.05;
const IRRIGATION_LOW_PH_THRESHOLD = 4;
const IRRIGATION_HIGH_PH_THRESHOLD = 10;
const getPhChemicalState = (ph) => ({
  acid: ph < PH_TARGET,
  base: ph > PH_TARGET,
});
const INITIAL_DASHBOARD_STATE = {
  tank: 100,
  tankSensor: {
    value: 100,
    online: false,
    lastUpdatedAt: null,
    error: '',
  },
  pumping: true,
  mainTankManualOverride: null,
  flowRate: 2.4,
  gh: { temp: 35, humidity: 65, fireAlert: false, fanOn: false },
  f1: { moisture: 62.4, ph: 6.81, wl: 21.3, n: 42, p: 35, k: 55, irrigation: false, drain: true, acid: true, base: false },
  f2: { moisture: 60.8, ph: 8.10, wl: 13.3, n: 38, p: 28, k: 48, irrigation: false, drain: false, acid: false, base: true },
  f3: { moisture: 24, ph: 3.2, wl: 8.5, n: 22, p: 18, k: 31, irrigation: false, drain: false, acid: true, base: false },
};

const ZERO_DASHBOARD_STATE = {
  tank: 0,
  tankSensor: {
    value: 0,
    online: false,
    lastUpdatedAt: null,
    error: '',
  },
  pumping: false,
  mainTankManualOverride: null,
  flowRate: 0,
  gh: { temp: 0, humidity: 0, fireAlert: false, fanOn: false },
  f1: { moisture: 0, ph: 0, wl: 0, n: 0, p: 0, k: 0, irrigation: false, drain: false, acid: false, base: false },
  f2: { moisture: 0, ph: 0, wl: 0, n: 0, p: 0, k: 0, irrigation: false, drain: false, acid: false, base: false },
  f3: { moisture: 0, ph: 0, wl: 0, n: 0, p: 0, k: 0, irrigation: false, drain: false, acid: false, base: false },
};

const createInitialDashboardState = () => applyMainTankRules({
  ...INITIAL_DASHBOARD_STATE,
  gh: { ...INITIAL_DASHBOARD_STATE.gh },
  f1: {
    ...INITIAL_DASHBOARD_STATE.f1,
    irrigation: false,
    ...getPhChemicalState(INITIAL_DASHBOARD_STATE.f1.ph),
  },
  f2: {
    ...INITIAL_DASHBOARD_STATE.f2,
    irrigation: false,
    ...getPhChemicalState(INITIAL_DASHBOARD_STATE.f2.ph),
  },
  f3: {
    ...INITIAL_DASHBOARD_STATE.f3,
    irrigation: false,
    ...getPhChemicalState(INITIAL_DASHBOARD_STATE.f3.ph),
  },
  time: '',
});

const clampValue = (value, min, max) => Math.max(min, Math.min(max, value));
const moistureToWaterLevel = (moisture) => Number(clampValue((moisture / 100) * 30, 0, 30).toFixed(1));
const waterLevelToMoisture = (waterLevel) => Number(clampValue((waterLevel / 30) * 100, 0, 100).toFixed(1));
const isFieldPhBalanced = (ph) => Math.abs(Number(ph ?? PH_TARGET) - PH_TARGET) <= PH_TARGET_TOLERANCE;
const isFieldPhOutOfRange = (ph) => Number(ph ?? PH_TARGET) < IRRIGATION_LOW_PH_THRESHOLD || Number(ph ?? PH_TARGET) > IRRIGATION_HIGH_PH_THRESHOLD;
const canFieldStartIrrigation = (fieldKey, field) => shouldFieldIrrigate(fieldKey, field, false);
const shouldFieldIrrigate = (fieldKey, field, wasIrrigating = false) => {
  const moisture = Number(field?.moisture ?? 0);
  const ph = Number(field?.ph ?? PH_TARGET);
  return moisture < IRRIGATION_AUTO_ON_MOISTURE_THRESHOLD && isFieldPhOutOfRange(ph);
};
const percentPerTickToLitersPerMinute = (percentPerTick) => (
  (percentPerTick / 100) * MAIN_TANK_CAPACITY_ML * (60000 / AUTOMATION_TICK_MS) / 1000
);
const isMainTankPumpOn = (tank, wasPumping = false) => (
  tank >= 100
    ? false
    : (wasPumping || tank < MAIN_TANK_REFILL_START_PERCENT)
);
const applyMainTankRules = (nextState, previousState = nextState) => {
  const tank = nextState.tank ?? previousState.tank ?? 0;
  const previousPumping = Boolean(previousState?.pumping);
  const manualOverride = typeof nextState.mainTankManualOverride === 'boolean'
    ? nextState.mainTankManualOverride
    : previousState?.mainTankManualOverride;
  const pumping = tank < MAIN_TANK_REFILL_START_PERCENT
    ? true
    : tank >= 100
      ? false
      : typeof manualOverride === 'boolean'
        ? manualOverride
        : isMainTankPumpOn(tank, previousPumping);
  const refillPercentPerTick = pumping
    ? (tank >= MAIN_TANK_FLOW_REDUCE_PERCENT ? MAIN_TANK_LOW_FILL_PERCENT_PER_TICK : MAIN_TANK_HIGH_FILL_PERCENT_PER_TICK)
    : 0;

  return {
    ...nextState,
    tank,
    mainTankManualOverride: typeof manualOverride === 'boolean' ? manualOverride : null,
    pumping,
    flowRate: Number(percentPerTickToLitersPerMinute(refillPercentPerTick).toFixed(1)),
  };
};
const moveToward = (value, target, step, digits = 1) => {
  if (Math.abs(target - value) <= step) {
    return Number(target.toFixed(digits));
  }

  const direction = target > value ? 1 : -1;
  return Number((value + direction * step).toFixed(digits));
};
const AgricultureDashboard = () => {
  const BASE_DASHBOARD_WIDTH = 1480;
  const [state, setState] = useState(createInitialDashboardState);
  const [isAutomationEnabled, setIsAutomationEnabled] = useState(false);
  const [isShutdownRequested, setIsShutdownRequested] = useState(false);

  const [isMounted, setIsMounted] = useState(false);
  const [isLoadingScreenVisible, setIsLoadingScreenVisible] = useState(true);
  const [dashboardHeight, setDashboardHeight] = useState(640);
  const [dashboardScale, setDashboardScale] = useState(1);
  const shellRef = useRef(null);
  const dashRef = useRef(null);
  const lastQueuedPayloadRef = useRef({});
  const dirtyFieldsRef = useRef({});
  const dirtyGreenhouseRef = useRef(false);
  const dirtyMainTankRef = useRef(false);
  const lastLocalUpdateRef = useRef(0);
  const activeEditFieldsRef = useRef({});
  const manualIrrigationOverrideRef = useRef({});
  const tankDrainIntervalRef = useRef(null);
  const isResetDrainingRef = useRef(false);
  const lastMainTankDataAtRef = useRef(null);

  const stopTankDrainAnimation = () => {
    if (tankDrainIntervalRef.current !== null) {
      window.clearInterval(tankDrainIntervalRef.current);
      tankDrainIntervalRef.current = null;
    }
    isResetDrainingRef.current = false;
  };

  const markSystemDirty = () => {
    dirtyFieldsRef.current = { f1: true, f2: true, f3: true };
    dirtyGreenhouseRef.current = true;
  };

  const markMainTankDirty = () => {
    dirtyMainTankRef.current = true;
  };

  const resetDashboard = () => {
    const startingTank = state.tank;
    const fieldSnapshot = [state.f1, state.f2, state.f3];
    const avgMoisture = fieldSnapshot.reduce((sum, field) => sum + (field?.moisture ?? 0), 0) / fieldSnapshot.length;
    const avgWaterLevel = fieldSnapshot.reduce((sum, field) => sum + (field?.wl ?? 0), 0) / fieldSnapshot.length;
    const moistureDemand = clampValue((100 - avgMoisture) / 100, 0, 1);
    
    const waterDemand = clampValue(avgWaterLevel / 30, 0, 1);
    const drainDemandFactor = 0.55 + moistureDemand * 0.9 + waterDemand * 0.55;
    const dynamicDrainStep = Number(clampValue(
      MAIN_TANK_DRAIN_STEP_PERCENT * drainDemandFactor,
      0.6,
      6
    ).toFixed(1));
    const dynamicDrainIntervalMs = Math.round(clampValue(
      MAIN_TANK_DRAIN_INTERVAL_MS * (1.15 - moistureDemand * 0.45 + waterDemand * 0.15),
      500,
      1800
    ));

    lastLocalUpdateRef.current = Date.now();
    markSystemDirty();
    setIsAutomationEnabled(false);
    stopTankDrainAnimation();
    activeEditFieldsRef.current = {};
    manualIrrigationOverrideRef.current = {};
    lastQueuedPayloadRef.current = {};
    isResetDrainingRef.current = startingTank > 0;
    setState({
      ...ZERO_DASHBOARD_STATE,
      tank: startingTank,
      pumping: false,
      flowRate: 0,
      f1: { ...ZERO_DASHBOARD_STATE.f1, irrigation: false },
      f2: { ...ZERO_DASHBOARD_STATE.f2, irrigation: false },
      f3: { ...ZERO_DASHBOARD_STATE.f3, irrigation: false },
      time: '',
    });

    if (startingTank > 0) {
      tankDrainIntervalRef.current = window.setInterval(() => {
        lastLocalUpdateRef.current = Date.now();
        markSystemDirty();
        setState((prev) => {
          if (prev.tank <= 0) {
            stopTankDrainAnimation();
            return {
              ...prev,
              tank: 0,
              pumping: false,
              flowRate: 0,
            };
          }

          const nextTank = Number(Math.max(0, prev.tank - dynamicDrainStep).toFixed(1));
          const drainedPercent = Number(Math.max(0, prev.tank - nextTank).toFixed(1));

          const hydrateFieldFromTank = (fieldKey, field) => {
            const nextMoisture = Number(clampValue((field.moisture ?? 0) + drainedPercent * 1.4, 0, 100).toFixed(1));
            const nextWaterLevel = moistureToWaterLevel(nextMoisture);
            const phFromMoisture = 1 + (nextMoisture / 10);
            const nextPh = Number(clampValue(Math.max(field.ph ?? 0, phFromMoisture), 0, 14).toFixed(2));

            return {
              ...field,
              moisture: nextMoisture,
              wl: nextWaterLevel,
              ph: nextPh,
              irrigation: shouldFieldIrrigate(
                fieldKey,
                { ...field, moisture: nextMoisture, ph: nextPh },
                Boolean(field.irrigation)
              ),
            };
          };

          if (nextTank <= 0) {
            stopTankDrainAnimation();
          }

          return {
            ...prev,
            tank: nextTank,
            pumping: false,
            flowRate: 0,
            f1: hydrateFieldFromTank('f1', prev.f1),
            f2: hydrateFieldFromTank('f2', prev.f2),
            f3: hydrateFieldFromTank('f3', prev.f3),
          };
        });
      }, dynamicDrainIntervalMs);
    }
  };

  const mergeDashboardState = (payloadState) => {
    if (!payloadState) return;

    setState((prevState) => {
      const isResetDraining = isResetDrainingRef.current;
      const incomingMainTankDataAt = payloadState.mainTankDataAt ?? null;
      const incomingTank = payloadState.tank;
      const hasFreshMainTankTimestamp = incomingMainTankDataAt !== null && incomingMainTankDataAt !== lastMainTankDataAtRef.current;
      const hasTankValueChanged = typeof incomingTank === 'number' && incomingTank !== prevState.tank;
      const hasFreshMainTankData = hasFreshMainTankTimestamp || hasTankValueChanged;

      if (hasFreshMainTankTimestamp) {
        lastMainTankDataAtRef.current = incomingMainTankDataAt;
      }

      ['f1', 'f2', 'f3'].forEach((fieldKey) => {
        const nextField = payloadState[fieldKey];
        if (!nextField) return;
        if (
          nextField.moisture !== prevState[fieldKey].moisture
          || nextField.ph !== prevState[fieldKey].ph
        ) {
          delete manualIrrigationOverrideRef.current[fieldKey];
        }
      });

      const mergedState = {
        ...prevState,
        tank: isResetDraining ? prevState.tank : (hasFreshMainTankData ? (incomingTank ?? prevState.tank) : prevState.tank),
        tankSensor: {
          ...prevState.tankSensor,
          ...(payloadState.tankSensor || {}),
        },
        pumping: isResetDraining ? false : (payloadState.pumping ?? prevState.pumping),
        mainTankManualOverride: isResetDraining ? false : (payloadState.mainTankManualOverride ?? prevState.mainTankManualOverride ?? null),
        flowRate: isResetDraining ? 0 : (payloadState.flowRate ?? prevState.flowRate),
        gh: { ...prevState.gh, ...(payloadState.gh || {}) },
        f1: activeEditFieldsRef.current.f1 ? prevState.f1 : (payloadState.f1 ?? prevState.f1),
        f2: activeEditFieldsRef.current.f2 ? prevState.f2 : (payloadState.f2 ?? prevState.f2),
        f3: activeEditFieldsRef.current.f3 ? prevState.f3 : (payloadState.f3 ?? prevState.f3),
        time: new Date().toLocaleTimeString(),
      };

      if (isResetDraining) {
        return mergedState;
      }

      return applyMainTankRules(mergedState, prevState);
    });
  };

  // --- INITIALIZE TIME ON CLIENT SIDE AFTER HYDRATION ---
  useEffect(() => {
    setIsMounted(true);
    setState(prevState => ({ ...prevState, time: new Date().toLocaleTimeString() }));
  }, []);

  useEffect(() => {
    if (!isAutomationEnabled) {
      return;
    }

    const intervalId = window.setInterval(() => {
      lastLocalUpdateRef.current = Date.now();
      markSystemDirty();

      setState((prev) => {
        const nextFields = {};
        let activeIrrigationCount = 0;

        ['f1', 'f2', 'f3'].forEach((fieldKey, index) => {
          const field = prev[fieldKey];
          const canIrrigate = prev.tank > 8;
          const computedIrrigation = canIrrigate && shouldFieldIrrigate(fieldKey, field, Boolean(field.irrigation));
          const manualOverride = manualIrrigationOverrideRef.current[fieldKey];
          const irrigation = typeof manualOverride === 'boolean' ? manualOverride : computedIrrigation;
          const drain = field.wl > 24 || (field.drain && field.wl > 17);

          if (irrigation) {
            activeIrrigationCount += 1;
          }

          const nextMoisture = clampValue(
            Number((field.moisture + (irrigation ? 1.5 : -0.45)).toFixed(1)),
            0,
            100
          );
          const nextWaterLevel = moistureToWaterLevel(nextMoisture);
          const phTarget = PH_TARGET;
          const { acid, base } = getPhChemicalState(field.ph);
          const nextPh = acid
            ? field.ph + 0.08
            : base
              ? field.ph - 0.08
              : moveToward(field.ph, phTarget, 0.03, 2);

          nextFields[fieldKey] = activeEditFieldsRef.current[fieldKey]
            ? prev[fieldKey]
            : {
                ...field,
                moisture: nextMoisture,
                wl: nextWaterLevel,
                ph: clampValue(Number(nextPh.toFixed(2)), 0, 14),
                n: clampValue(Number((field.n - (irrigation ? 0.25 : 0.08)).toFixed(1)), 0, 100),
                p: clampValue(Number((field.p - (irrigation ? 0.2 : 0.06)).toFixed(1)), 0, 100),
                k: clampValue(Number((field.k - (irrigation ? 0.22 : 0.07)).toFixed(1)), 0, 100),
                irrigation,
                drain,
                acid,
                base,
              };
        });

        const derivedMainTankState = applyMainTankRules(prev, prev);
        const nextTemp = derivedMainTankState.pumping
          ? moveToward(prev.gh.temp, 31, 0.4, 1)
          : moveToward(prev.gh.temp, 38, 0.3, 1);
        const nextHumidity = activeIrrigationCount > 0
          ? moveToward(prev.gh.humidity, 74, 0.7, 1)
          : moveToward(prev.gh.humidity, 62, 0.5, 1);

        return {
          ...prev,
          ...derivedMainTankState,
          gh: {
            ...prev.gh,
            temp: nextTemp,
            humidity: nextHumidity,
            fireAlert: nextTemp >= 52,
          },
          ...nextFields,
          time: new Date().toLocaleTimeString(),
        };
      });
    }, AUTOMATION_TICK_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isAutomationEnabled]);

  useEffect(() => {
    const timerId = window.setTimeout(() => {
      setIsLoadingScreenVisible(false);
    }, 10000);

    return () => {
      window.clearTimeout(timerId);
    };
  }, []);

  useEffect(() => {
    let isCancelled = false;

    const refreshFromServer = async () => {
      if (Date.now() - lastLocalUpdateRef.current < 1500) {
        return;
      }

      try {
        const response = await fetch(`${API_BASE}/status`);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const payload = await response.json();
        if (isCancelled || !payload?.state) return;

        mergeDashboardState(payload.state);
      } catch (error) {
        if (!isCancelled) {
          console.error(`Python server sync failed: ${error.message}`);
        }
      }
    };

    refreshFromServer();
    const intervalId = window.setInterval(refreshFromServer, 4000);

    return () => {
      isCancelled = true;
      window.clearInterval(intervalId);
    };
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

  useEffect(() => {
    return () => {
      stopTankDrainAnimation();
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

  const fanOn =
    (state.gh.temp ?? 0) > GREENHOUSE_FAN_TEMP_THRESHOLD ||
    (state.gh.humidity ?? 0) > GREENHOUSE_FAN_HUMIDITY_THRESHOLD;
  const fireOn = state.gh.fireAlert;
  const fanSpeedClass = fanOn ? "spin-med" : "spin-stop";
  const isMainTankReducedFlow = state.pumping && state.tank > MAIN_TANK_FLOW_REDUCE_PERCENT;
  const mainTankPumpSpeedClass = state.pumping
    ? (isMainTankReducedFlow ? 'spin-slow' : 'spin-med')
    : 'spin-stop';
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

  const buildFieldPayload = (fieldKey) => {
    const field = state[fieldKey];

    return {
      field: fieldKey,
      moisture: field.moisture,
      ph: field.ph,
      waterLevel: field.wl,
      n: field.n,
      p: field.p,
      k: field.k,
      irrigation: field.irrigation,
      manualIrrigationControl: manualIrrigationOverrideRef.current[fieldKey] !== undefined,
      drain: field.drain,
      acid: field.acid,
      base: field.base,
    };
  };

  const sendFieldToServer = async (fieldKey, payload) => {
    const endpoint = FIELD_ENDPOINTS[fieldKey];
    if (!endpoint) {
      console.error(`No Python endpoint configured for ${fieldKey.toUpperCase()}`);
      return;
    }

    lastLocalUpdateRef.current = Date.now();

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const payloadFromServer = await response.json();
      mergeDashboardState(payloadFromServer?.dashboard?.state);

      if (!response.ok) {
        throw new Error(payloadFromServer?.error || `HTTP ${response.status}`);
      }

      if (payloadFromServer?.warning) {
        console.warn(payloadFromServer.warning);
      }
    } catch (error) {
      dirtyFieldsRef.current[fieldKey] = true;
      console.error(`Failed to send ${fieldKey.toUpperCase()} values: ${error.message}`);
    }
  };

  const buildGreenhousePayload = () => ({
    temp: state.gh.temp,
    humidity: state.gh.humidity,
    fireAlert: state.gh.fireAlert,
  });

  const buildMainTankPayload = () => ({
    tank: state.tank,
    pumping: state.pumping,
    mainTankManualOverride: state.mainTankManualOverride,
  });

  const updateGreenhouse = (patch) => {
    lastLocalUpdateRef.current = Date.now();
    dirtyGreenhouseRef.current = true;
    setState((prev) => ({
      ...prev,
      gh: { ...prev.gh, ...patch },
    }));
  };

  const sendGreenhouseToServer = async (payload) => {
    lastLocalUpdateRef.current = Date.now();

    try {
      const response = await fetch(GREENHOUSE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const payloadFromServer = await response.json();
      mergeDashboardState(payloadFromServer?.dashboard?.state);

      if (!response.ok) {
        throw new Error(payloadFromServer?.error || `HTTP ${response.status}`);
      }

      if (payloadFromServer?.warning) {
        console.warn(payloadFromServer.warning);
      }
    } catch (error) {
      dirtyGreenhouseRef.current = true;
      console.error(`Failed to send greenhouse values: ${error.message}`);
    }
  };

  const sendMainTankToServer = async (payload) => {
    lastLocalUpdateRef.current = Date.now();

    try {
      const response = await fetch(MAIN_TANK_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const payloadFromServer = await response.json();
      mergeDashboardState(payloadFromServer?.dashboard?.state);

      if (!response.ok) {
        throw new Error(payloadFromServer?.error || `HTTP ${response.status}`);
      }

      if (payloadFromServer?.warning || payloadFromServer?.relayWarning) {
        console.warn(payloadFromServer.warning || payloadFromServer.relayWarning);
      }
    } catch (error) {
      dirtyMainTankRef.current = true;
      console.error(`Failed to send main tank values: ${error.message}`);
    }
  };

  const shutdownRaspberryPi = async () => {
    const shouldShutdown = window.confirm('Shut down the Raspberry Pi now? This will stop the dashboard and connected control services.');
    if (!shouldShutdown) {
      return;
    }

    setIsShutdownRequested(true);

    try {
      const response = await fetch(SHUTDOWN_ENDPOINT, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const rawResponse = await response.text();
      const payloadFromServer = rawResponse ? JSON.parse(rawResponse) : {};

      if (!response.ok) {
        throw new Error(payloadFromServer?.error || `HTTP ${response.status}`);
      }
    } catch (error) {
      setIsShutdownRequested(false);
      window.alert(`Failed to shut down Raspberry Pi: ${error.message}`);
      console.error(`Failed to shut down Raspberry Pi: ${error.message}`);
    }
  };

  useEffect(() => {
    ['f1', 'f2', 'f3'].forEach((fieldKey) => {
      const payload = buildFieldPayload(fieldKey);
      const serializedPayload = JSON.stringify(payload);

      if (!dirtyFieldsRef.current[fieldKey]) {
        lastQueuedPayloadRef.current[fieldKey] = serializedPayload;
        return;
      }

      if (lastQueuedPayloadRef.current[fieldKey] === serializedPayload) {
        return;
      }

      lastQueuedPayloadRef.current[fieldKey] = serializedPayload;
      dirtyFieldsRef.current[fieldKey] = false;
      sendFieldToServer(fieldKey, payload);
    });
  }, [state.f1, state.f2, state.f3]);

  useEffect(() => {
    if (!dirtyGreenhouseRef.current) {
      return;
    }

    dirtyGreenhouseRef.current = false;
    sendGreenhouseToServer(buildGreenhousePayload());
  }, [state.gh]);

  useEffect(() => {
    if (!dirtyMainTankRef.current) {
      return;
    }

    dirtyMainTankRef.current = false;
    sendMainTankToServer(buildMainTankPayload());
  }, [state.tank, state.pumping, state.mainTankManualOverride]);

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
    const showPhControls = true;
    const showChemicalControls = true;
    const [isMoistureDragging, setIsMoistureDragging] = useState(false);
    const [dragTarget, setDragTarget] = useState(null);
    const [liveField, setLiveField] = useState(null);
    const activeDragRef = useRef(null);
    const moistureGaugeRef = useRef(null);
    const waterLevelRef = useRef(null);
    const phTrackRef = useRef(null);
    const npkTrackRefs = useRef({});
    const dragStartRef = useRef({ x: 0, y: 0 });
    const dragArmedRef = useRef(false);
    const pendingFieldPatchRef = useRef({});
    const pendingLivePatchRef = useRef({});
    const livePatchFrameRef = useRef(null);
    const moistureAnimationFrameRef = useRef(null);
    const moistureTargetRef = useRef(data.moisture);
    const moistureDisplayRef = useRef(data.moisture);
    const patchTimeoutRef = useRef(null);
    const lastPatchFlushRef = useRef(0);
    const dragListenersBoundRef = useRef(false);
    const dragCleanupRef = useRef(null);
    const touchScrollLockRef = useRef(null);
    const moistureValue = liveField?.moisture ?? data.moisture;
    const phValue = liveField?.ph ?? data.ph;
    const wlValue = liveField?.wl ?? data.wl;
    const nValue = liveField?.n ?? data.n;
    const pValue = liveField?.p ?? data.p;
    const kValue = liveField?.k ?? data.k;
    const irrigationValue = liveField?.irrigation ?? data.irrigation;
    const mc = moistureColor(moistureValue);
    const phPct = (phValue / 14 * 100).toFixed(1);
    const wlPct = Math.min(wlValue / 30 * 100, 100);
    const moistureAngle = -90 + (moistureValue / 100) * 180;
    const fieldScaleTicks = [
      { value: 30, position: 100, emphasis: true },
      { value: 20, position: 66.7 },
      { value: 10, position: 33.3 },
      { value: 0, position: 0, emphasis: true }
    ];
    const updateField = (patch) => {
      lastLocalUpdateRef.current = Date.now();
      dirtyFieldsRef.current[fieldKey] = true;
      setState((prev) => ({
        ...prev,
        [fieldKey]: (() => {
          const nextField = { ...prev[fieldKey], ...patch };
          let nextManualOverride = manualIrrigationOverrideRef.current[fieldKey];

          if (Object.prototype.hasOwnProperty.call(patch, 'irrigation')) {
            if (patch.irrigation) {
              const canStart = canFieldStartIrrigation(fieldKey, nextField);
              nextField.irrigation = canStart;
              nextManualOverride = canStart ? true : undefined;
            } else {
              nextField.irrigation = false;
              nextManualOverride = false;
            }
          }

          if (
            Object.prototype.hasOwnProperty.call(patch, 'moisture')
            || Object.prototype.hasOwnProperty.call(patch, 'wl')
            || Object.prototype.hasOwnProperty.call(patch, 'ph')
          ) {
            nextManualOverride = undefined;
          }

          if (
            Object.prototype.hasOwnProperty.call(patch, 'moisture')
            || Object.prototype.hasOwnProperty.call(patch, 'wl')
          ) {
            nextField.irrigation = shouldFieldIrrigate(fieldKey, nextField, Boolean(prev[fieldKey]?.irrigation));
          }
          if (Object.prototype.hasOwnProperty.call(patch, 'ph')) {
            Object.assign(nextField, getPhChemicalState(nextField.ph ?? PH_TARGET));
            nextField.irrigation = shouldFieldIrrigate(fieldKey, nextField, Boolean(prev[fieldKey]?.irrigation));
          }

          if (nextManualOverride === undefined) {
            delete manualIrrigationOverrideRef.current[fieldKey];
          } else {
            manualIrrigationOverrideRef.current[fieldKey] = nextManualOverride;
          }

          return nextField;
        })(),
      }));
    };
    const scheduleFieldPatch = (patch) => {
      pendingFieldPatchRef.current = { ...pendingFieldPatchRef.current, ...patch };
      if (patchTimeoutRef.current !== null) return;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      const remaining = Math.max(0, DRAG_COMMIT_INTERVAL_MS - (now - lastPatchFlushRef.current));
      patchTimeoutRef.current = window.setTimeout(() => {
        patchTimeoutRef.current = null;
        flushFieldPatch();
      }, remaining);
    };
    const setLivePatch = (patch) => {
      pendingLivePatchRef.current = { ...pendingLivePatchRef.current, ...patch };
      if (livePatchFrameRef.current !== null) return;
      livePatchFrameRef.current = window.requestAnimationFrame(() => {
        livePatchFrameRef.current = null;
        const nextPatch = pendingLivePatchRef.current;
        pendingLivePatchRef.current = {};
        setLiveField((prev) => ({ ...(prev ?? {}), ...nextPatch }));
      });
    };
    const flushFieldPatch = () => {
      const nextPatch = pendingFieldPatchRef.current;
      pendingFieldPatchRef.current = {};
      if (Object.keys(nextPatch).length) {
        lastPatchFlushRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
        updateField(nextPatch);
      }
    };
    const stopMoistureAnimation = () => {
      if (moistureAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(moistureAnimationFrameRef.current);
        moistureAnimationFrameRef.current = null;
      }
    };
    const setMoistureDisplayValue = (next) => {
      const normalized = Number(clamp(next, 0, 100).toFixed(1));
      const linkedWaterLevel = moistureToWaterLevel(normalized);
      moistureDisplayRef.current = normalized;
      setLivePatch({ moisture: normalized, wl: linkedWaterLevel });
      scheduleFieldPatch({ moisture: normalized, wl: linkedWaterLevel });
    };
    const animateMoistureTowardTarget = () => {
      moistureAnimationFrameRef.current = null;
      const target = moistureTargetRef.current;
      const current = moistureDisplayRef.current;
      const delta = target - current;
      const eased = Math.abs(delta) < 0.2
        ? target
        : Number((current + delta * 0.28).toFixed(1));

      setMoistureDisplayValue(eased);

      if (Math.abs(target - eased) >= 0.1 || activeDragRef.current?.type === 'moisture') {
        moistureAnimationFrameRef.current = window.requestAnimationFrame(animateMoistureTowardTarget);
      }
    };
    const queueMoistureAnimation = () => {
      if (moistureAnimationFrameRef.current !== null) return;
      moistureAnimationFrameRef.current = window.requestAnimationFrame(animateMoistureTowardTarget);
    };
    const lockTouchScroll = () => {
      if (touchScrollLockRef.current || typeof document === 'undefined') return;
      touchScrollLockRef.current = {
        bodyOverflow: document.body.style.overflow,
        bodyTouchAction: document.body.style.touchAction,
        docOverflow: document.documentElement.style.overflow,
        docTouchAction: document.documentElement.style.touchAction,
      };
      document.body.style.overflow = 'hidden';
      document.body.style.touchAction = 'none';
      document.documentElement.style.overflow = 'hidden';
      document.documentElement.style.touchAction = 'none';
    };
    const unlockTouchScroll = () => {
      if (!touchScrollLockRef.current || typeof document === 'undefined') return;
      document.body.style.overflow = touchScrollLockRef.current.bodyOverflow;
      document.body.style.touchAction = touchScrollLockRef.current.bodyTouchAction;
      document.documentElement.style.overflow = touchScrollLockRef.current.docOverflow;
      document.documentElement.style.touchAction = touchScrollLockRef.current.docTouchAction;
      touchScrollLockRef.current = null;
    };
    const setMoistureFromPointer = (clientX, clientY, { immediate = false } = {}) => {
      if (!moistureGaugeRef.current) return;
      const rect = moistureGaugeRef.current.getBoundingClientRect();
      const x = ((clientX - rect.left) / rect.width) * 164;
      const y = ((clientY - rect.top) / rect.height) * 112;
      const rawAngle = Math.atan2(x - 78, 72 - y) * (180 / Math.PI);
      const clampedAngle = clamp(rawAngle, -90, 90);
      const moisture = ((clampedAngle + 90) / 180) * 100;
      const next = Number(moisture.toFixed(1));
      moistureTargetRef.current = next;
      if (immediate) {
        stopMoistureAnimation();
        setMoistureDisplayValue(next);
        return;
      }
      queueMoistureAnimation();
    };
    const setPhFromPointer = (clientX) => {
      if (!phTrackRef.current) return;
      const rect = phTrackRef.current.getBoundingClientRect();
      const pct = clamp((clientX - rect.left) / rect.width, 0, 1);
      const next = Number((pct * 14).toFixed(2));
      setLivePatch({ ph: next, ...getPhChemicalState(next) });
      scheduleFieldPatch({ ph: next });
    };
    const setWaterLevelFromPointer = (clientY) => {
      if (!waterLevelRef.current) return;
      const rect = waterLevelRef.current.getBoundingClientRect();
      const pct = clamp((rect.bottom - clientY) / rect.height, 0, 1);
      const next = Number((pct * 30).toFixed(1));
      const linkedMoisture = waterLevelToMoisture(next);
      moistureTargetRef.current = linkedMoisture;
      moistureDisplayRef.current = linkedMoisture;
      setLivePatch({ wl: next, moisture: linkedMoisture });
      scheduleFieldPatch({ wl: next, moisture: linkedMoisture });
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
      activeEditFieldsRef.current[fieldKey] = true;
      setLiveField({ moisture: data.moisture, ph: data.ph, wl: data.wl, n: data.n, p: data.p, k: data.k });
      moistureDisplayRef.current = liveField?.moisture ?? data.moisture;
      moistureTargetRef.current = liveField?.moisture ?? data.moisture;
      activeDragRef.current = target;
      dragStartRef.current = { x: startX, y: startY };
      dragArmedRef.current = false;
      lastPatchFlushRef.current = 0;
      setDragTarget(target.type === 'moisture' ? 'moisture' : target.type === 'ph' ? 'ph' : target.type === 'wl' ? 'wl' : target.key);
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
      if (activeDragRef.current.type === 'wl') {
        setWaterLevelFromPointer(clientY);
        return;
      }
      if (activeDragRef.current.type === 'npk') {
        setNpkFromPointer(activeDragRef.current.key, clientX);
      }
    };
    const endDrag = () => {
      if (activeDragRef.current?.type === 'moisture') {
        stopMoistureAnimation();
        setMoistureDisplayValue(moistureTargetRef.current);
      }
      activeDragRef.current = null;
      dragArmedRef.current = false;
      setIsMoistureDragging(false);
      setDragTarget(null);
      flushFieldPatch();
      pendingLivePatchRef.current = {};
      setLiveField(null);
      unlockTouchScroll();
      window.setTimeout(() => {
        activeEditFieldsRef.current[fieldKey] = false;
      }, 250);
    };
    const bindGlobalDragListeners = () => {
      if (dragListenersBoundRef.current) return;
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
      document.addEventListener('mousemove', onMove, { passive: false });
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onEnd);
      document.addEventListener('touchcancel', onEnd);
      dragCleanupRef.current = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onEnd);
        document.removeEventListener('touchmove', onMove);
        document.removeEventListener('touchend', onEnd);
        document.removeEventListener('touchcancel', onEnd);
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
      if (!activeDragRef.current || activeDragRef.current.type !== 'moisture') {
        moistureDisplayRef.current = moistureValue;
        moistureTargetRef.current = moistureValue;
      }
    }, [moistureValue]);

    useEffect(() => {
      return () => {
        if (livePatchFrameRef.current !== null) {
          window.cancelAnimationFrame(livePatchFrameRef.current);
        }
        stopMoistureAnimation();
        if (patchTimeoutRef.current !== null) {
          window.clearTimeout(patchTimeoutRef.current);
        }
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
              background: irrigationValue ? '#3b82f6' : data.drain ? '#ef4444' : 'transparent',
              border: irrigationValue || data.drain ? 'none' : '1px solid transparent'
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
                onMouseDown={(event) => {
                  event.preventDefault();
                  startDrag({ type: 'moisture' }, event.clientX, event.clientY);
                  setMoistureFromPointer(event.clientX, event.clientY, { immediate: true });
                  bindGlobalDragListeners();
                }}
                onTouchStart={(event) => {
                  if (!event.touches[0]) return;
                  if (event.cancelable) event.preventDefault();
                  startDrag({ type: 'moisture' }, event.touches[0].clientX, event.touches[0].clientY);
                  lockTouchScroll();
                  setMoistureFromPointer(event.touches[0].clientX, event.touches[0].clientY, { immediate: true });
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
                <circle
                  className={`moisture-needle-hitbox ${isMoistureDragging ? 'dragging' : ''}`}
                  cx="78"
                  cy="26"
                  r="16"
                  fill="transparent"
                  style={{ transform: `rotate(${moistureAngle}deg)`, transformOrigin: '78px 72px' }}
                />
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
            <div
              ref={waterLevelRef}
              className={`water-level-indicator ${dragTarget === 'wl' ? 'dragging' : ''}`}
              onMouseDown={(event) => {
                event.preventDefault();
                startDrag({ type: 'wl' }, event.clientX, event.clientY);
                setWaterLevelFromPointer(event.clientY);
                bindGlobalDragListeners();
              }}
              onTouchStart={(event) => {
                if (!event.touches[0]) return;
                if (event.cancelable) event.preventDefault();
                startDrag({ type: 'wl' }, event.touches[0].clientX, event.touches[0].clientY);
                setWaterLevelFromPointer(event.touches[0].clientY);
                lockTouchScroll();
                bindGlobalDragListeners();
              }}
              style={{ cursor: dragTarget === 'wl' ? 'grabbing' : 'ns-resize', touchAction: 'none' }}
              title="Drag up or down to set water level"
            >
              <div className="tank-meter compact water-level-indicator-inner">
                <div className="field-tank">
                  <AnimatedWaterFill height={`${wlPct}%`} />
                </div>
                <WaterScale ticks={fieldScaleTicks} compact />
              </div>
            </div>
            <div className="val" style={{ marginLeft: '-45px' }}>{wlValue.toFixed(1)} cm</div>
            <span className="lbl" style={{ marginLeft: '-45px' }}>Water</span>
          </div>
          <div className="col" style={{ width: '100%' }}>
            <div style={{ width: '100%', fontSize: '10px', color: '#475569', fontWeight: 700, display: 'flex', justifyContent: 'space-between' }}><span>0</span><span>7</span><span>14</span></div>
            <div
              ref={phTrackRef}
              className={`ph-track ${dragTarget === 'ph' ? 'dragging' : ''}`}
              onMouseDown={showPhControls ? (event) => {
                event.preventDefault();
                startDrag({ type: 'ph' }, event.clientX, event.clientY);
                setPhFromPointer(event.clientX);
                bindGlobalDragListeners();
              } : undefined}
              onTouchStart={showPhControls ? (event) => {
                if (!event.touches[0]) return;
                if (event.cancelable) event.preventDefault();
                startDrag({ type: 'ph' }, event.touches[0].clientX, event.touches[0].clientY);
                setPhFromPointer(event.touches[0].clientX);
                lockTouchScroll();
                bindGlobalDragListeners();
              } : undefined}
              style={{ cursor: showPhControls ? (dragTarget === 'ph' ? 'grabbing' : 'grab') : 'default', touchAction: showPhControls ? 'none' : 'auto' }}
              title={showPhControls ? 'Drag to set pH' : 'pH level display'}
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
                   onMouseDown={(event) => {
                     event.preventDefault();
                     startDrag({ type: 'npk', key: item.key }, event.clientX, event.clientY);
                     setNpkFromPointer(item.key, event.clientX);
                     bindGlobalDragListeners();
                   }}
                   onTouchStart={(event) => {
                     if (!event.touches[0]) return;
                     if (event.cancelable) event.preventDefault();
                     startDrag({ type: 'npk', key: item.key }, event.touches[0].clientX, event.touches[0].clientY);
                     setNpkFromPointer(item.key, event.touches[0].clientX);
                     lockTouchScroll();
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
        <div style={{ marginTop: '10px', paddingTop: '9px', borderTop: '0.5px solid #f1f5f9', display: 'grid', gridTemplateColumns: showChemicalControls ? 'repeat(4, minmax(0, 1fr))' : 'repeat(2, minmax(0, 1fr))', columnGap: '10px', alignItems: 'center' }}>
          <StatusChip on={irrigationValue} label="Irrigation" activeColor="#3b82f6" onClick={() => updateField({ irrigation: !irrigationValue })} />
          <StatusChip on={data.drain} label="Drain" activeColor="#ef4444" onClick={() => updateField({ drain: !data.drain })} />
          {showChemicalControls ? <StatusChip on={data.acid} label="Acid" onClick={() => updateField({ acid: !data.acid })} /> : null}
          {showChemicalControls ? <StatusChip on={data.base} label="Base" onClick={() => updateField({ base: !data.base })} /> : null}
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
          position: relative;
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
          min-width: 1480px;
          max-width: 100%;
          margin: 0;
        }

        .loading-screen {
          position: fixed;
          inset: 0;
          z-index: 9999;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background:
            radial-gradient(circle at center, rgba(20, 184, 166, 0.16) 0%, rgba(255, 255, 255, 0.96) 42%, #ffffff 72%);
          backdrop-filter: blur(8px);
        }

        .loading-screen::before {
          content: '';
          position: absolute;
          width: min(70vw, 760px);
          height: min(70vw, 760px);
          border-radius: 50%;
          background: radial-gradient(circle, rgba(14, 165, 233, 0.16) 0%, rgba(45, 212, 191, 0.1) 35%, rgba(255,255,255,0) 72%);
          filter: blur(14px);
          animation: splashPulse 2.8s ease-in-out infinite;
        }

        .loading-card {
          position: relative;
          z-index: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 18px;
          width: min(100%, 760px);
        }

        .loading-image {
          width: min(100%, 680px);
          height: auto;
          object-fit: contain;
          filter: drop-shadow(0 22px 42px rgba(15, 23, 42, 0.14));
          animation: splashFloat 2.4s ease-in-out infinite;
        }

        .loading-copy {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          color: #334155;
          text-align: center;
        }

        .loading-title {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0.02em;
          color: #0f172a;
        }

        .loading-subtitle {
          font-size: 15px;
          font-weight: 600;
          color: #475569;
        }

        .loading-progress {
          width: min(320px, 72vw);
          height: 7px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.22);
          overflow: hidden;
          box-shadow: inset 0 1px 2px rgba(15, 23, 42, 0.08);
        }

        .loading-progress-bar {
          width: 100%;
          height: 100%;
          transform-origin: left center;
          background: linear-gradient(90deg, #dbeafe 0%, #2563eb 46%, #14b8a6 100%);
          animation: loadingBar 10s linear forwards;
        }

        .top-navbar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 18px;
          margin-bottom: 14px;
          padding: 14px 20px;
          border-radius: 18px;
          background: linear-gradient(135deg, #0f766e 0%, #0d9488 48%, #14b8a6 100%);
          box-shadow: 0 12px 28px rgba(13, 148, 136, 0.22);
        }

        .top-navbar-title {
          color: #f8fafc;
          font-size: 30px;
          font-weight: 900;
          letter-spacing: 0.01em;
          text-align: left;
        }

        .top-navbar-logos {
          display: flex;
          align-items: center;
          justify-content: flex-end;
          gap: 14px;
          margin-left: auto;
          flex-wrap: wrap;
        }

        .top-navbar-right {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-left: auto;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .top-navbar-actions {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .navbar-action-btn {
          border: none;
          border-radius: 14px;
          padding: 10px 16px;
          font-size: 16px;
          font-weight: 800;
          cursor: pointer;
          color: #ffffff;
          transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
          box-shadow: 0 6px 18px rgba(15, 23, 42, 0.16);
        }

        .navbar-action-btn:hover {
          transform: translateY(-1px);
        }

        .navbar-action-btn.reset {
          background: linear-gradient(135deg, #dc2626 0%, #f97316 100%);
        }

        .navbar-action-btn.automate {
          background: linear-gradient(135deg, #1d4ed8 0%, #0ea5e9 100%);
        }

        .navbar-action-btn.automate.active {
          background: linear-gradient(135deg, #065f46 0%, #10b981 100%);
        }

        .navbar-action-btn.shutdown {
          display: inline-flex;
          align-items: center;
          gap: 10px;
          background: linear-gradient(135deg, #7f1d1d 0%, #dc2626 100%);
          padding-right: 18px;
          box-shadow: 0 10px 24px rgba(127, 29, 29, 0.3);
        }

        .navbar-action-btn.shutdown:hover {
          box-shadow: 0 14px 28px rgba(127, 29, 29, 0.38);
        }

        .shutdown-power-icon {
          position: relative;
          width: 24px;
          height: 24px;
          border: 2.5px solid rgba(255, 255, 255, 0.95);
          border-top-color: transparent;
          border-radius: 50%;
          flex: 0 0 auto;
        }

        .shutdown-power-icon::before {
          content: '';
          position: absolute;
          top: -4px;
          left: 50%;
          width: 2.5px;
          height: 12px;
          border-radius: 999px;
          background: rgba(255, 255, 255, 0.95);
          transform: translateX(-50%);
          box-shadow: 0 0 10px rgba(255, 255, 255, 0.24);
        }

        .shutdown-label {
          letter-spacing: 0.02em;
        }

        .navbar-action-btn:disabled {
          cursor: not-allowed;
          opacity: 0.7;
          transform: none;
        }

        .top-navbar-logo-box {
          display: flex;
          align-items: center;
          justify-content: center;
          min-width: 78px;
          height: 58px;
          padding: 8px 12px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.96);
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.8), 0 5px 16px rgba(15, 23, 42, 0.14);
        }

        .top-navbar-logo {
          display: block;
          max-width: 100%;
          max-height: 42px;
          object-fit: contain;
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
          grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.95fr);
          gap: 22px;
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
        @keyframes splashFloat {
          0% { transform: translateY(0); }
          50% { transform: translateY(-8px); }
          100% { transform: translateY(0); }
        }
        @keyframes splashPulse {
          0% { transform: scale(0.92); opacity: 0.72; }
          50% { transform: scale(1.02); opacity: 1; }
          100% { transform: scale(0.92); opacity: 0.72; }
        }
        @keyframes loadingBar {
          0% { transform: scaleX(0); }
          100% { transform: scaleX(1); }
        }
        
        .spin-slow { animation: spin 3.5s linear infinite; }
        .spin-med { animation: spin 1s linear infinite; }
        .spin-fast { animation: spin 0.35s linear infinite; }
        .spin-turbo { animation: spin 0.18s linear infinite; }
        .spin-stop { }

        .pipe { position: relative; overflow: hidden; border-radius: 3px; background: #bae6fd; height: 6px; width: 28px; }
        .pipe-flow { position: absolute; top: 0; left: 0; width: 35%; height: 100%; background: linear-gradient(90deg, transparent, rgba(255,255,255,0.7), transparent); animation: flow 1.2s linear infinite; }
        .pipe-flow.pipe-flow-slow { animation-duration: 2.4s; }
        .pipe-stopped { background: #e2e8f0; }
        .pipe-stopped .pipe-flow { display: none; }

        .tank-meter { display: flex; align-items: stretch; gap: 7px; }
        .tank-meter.compact { gap: 6px; }
        .tank-meter.main-tank-meter {
          gap: 12px;
          align-items: center;
        }
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
        .main-tank-value {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 22px;
          font-weight: 800;
          color: #075985;
          text-shadow: 0 1px 4px rgba(255,255,255,0.92);
          z-index: 5;
          pointer-events: none;
        }
        .main-tank-meter .water-scale {
          height: 114px;
          width: 34px;
          font-size: 10px;
        }
        .main-tank-meter .scale-line {
          width: 12px;
        }
        .main-tank-meter .scale-tick.emphasis .scale-line {
          width: 15px;
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
          user-select: none;
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
          margin-left: -24px;
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
        .moisture-needle {
          transition: transform 90ms ease-out, filter 140ms ease-out;
          will-change: transform;
        }
        .moisture-needle.dragging {
          transition: none;
          filter: drop-shadow(0 0 6px rgba(14, 165, 233, 0.28));
        }
        .moisture-needle-hitbox {
          cursor: grab;
          pointer-events: all;
        }
        .moisture-needle-hitbox.dragging {
          cursor: grabbing;
        }
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
          .top-navbar {
            flex-direction: column;
            align-items: flex-start;
          }
          .top-navbar-right {
            width: 100%;
            justify-content: space-between;
          }
          .top-navbar-actions {
            justify-content: flex-start;
          }
          .top-navbar-logos {
            width: 100%;
            justify-content: flex-start;
            margin-left: 0;
          }
          .farmhouse-panel {
            padding-left: 0;
            padding-right: 0;
          }
        }
      `}</style>

      {isLoadingScreenVisible ? (
        <div className="loading-screen" aria-live="polite" aria-busy="true">
          <div className="loading-card">
            <img
              src={cyberMainSplash}
              alt="Smart Agriculture Model loading screen"
              className="loading-image"
            />
            <div className="loading-copy">
              <div className="loading-title">Loading Smart Agriculture Model</div>
              <div className="loading-subtitle">Initializing sensors and preparing live dashboard data...</div>
              <div className="loading-progress">
                <div className="loading-progress-bar"></div>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
        <div className="top-navbar">
          <div className="top-navbar-title">Smart Agriculture Model</div>
          <div className="top-navbar-right">
            <div className="top-navbar-actions">
              <button type="button" className="navbar-action-btn reset" onClick={resetDashboard}>
                Reset System
              </button>
              <button
                type="button"
                className={`navbar-action-btn automate ${isAutomationEnabled ? 'active' : ''}`}
                onClick={() => setIsAutomationEnabled((prev) => !prev)}
              >
                {isAutomationEnabled ? 'Automate On' : 'Automate'}
              </button>
            </div>
            <div className="top-navbar-logos">
              <div className="top-navbar-logo-box">
                <img src={cyberLancersLogo} alt="CyberLancers logo" className="top-navbar-logo" />
              </div>
              <div className="top-navbar-logo-box">
                <img src={cdacLogo} alt="CDAC logo" className="top-navbar-logo" />
              </div>
            </div>
            <button
              type="button"
              className="navbar-action-btn shutdown"
              onClick={shutdownRaspberryPi}
              disabled={isShutdownRequested}
              aria-label="Shut down Raspberry Pi"
            >
              <span className="shutdown-power-icon" aria-hidden="true"></span>
              <span className="shutdown-label">
               
              </span>
            </button>
          </div>
        </div>
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
              <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className={`pipe-flow ${isMainTankReducedFlow ? 'pipe-flow-slow' : ''}`}></div></div>
              <div className="col">
                <div
                  style={{ width: '62px', height: '62px', borderRadius: '50%', border: '2px solid #94a3b8', display: 'flex', alignItems: 'center', justifyContent: 'center', background: state.pumping ? 'radial-gradient(circle at 35% 35%, #f0f9ff 0%, #bfdbfe 62%, #7dd3fc 100%)' : 'radial-gradient(circle at 35% 35%, #fff1f2 0%, #fecdd3 62%, #fda4af 100%)', boxShadow: state.pumping ? '0 10px 22px rgba(14, 165, 233, 0.22)' : '0 8px 18px rgba(244, 63, 94, 0.14)', transition: 'background 0.8s, box-shadow 0.3s', cursor: 'pointer' }}
                  onClick={() => {
                    lastLocalUpdateRef.current = Date.now();
                    markMainTankDirty();
                    setState((prev) => {
                      const nextPumping = !prev.pumping;
                      return applyMainTankRules({
                        ...prev,
                        pumping: nextPumping,
                        mainTankManualOverride: nextPumping,
                      }, prev);
                    });
                  }}
                  title="Toggle main tank motor"
                >
                  <svg width="48" height="48" viewBox="0 0 56 56" aria-hidden="true">
                    <circle cx="28" cy="28" r="22" fill={state.pumping ? '#e0f2fe' : '#ffe4e6'} stroke={state.pumping ? '#38bdf8' : '#fda4af'} strokeWidth="2" />
                    <circle cx="28" cy="28" r="16" fill={state.pumping ? '#0ea5e9' : '#fb7185'} opacity="0.2" />
                    <g className={mainTankPumpSpeedClass} style={{ transformOrigin: '28px 28px' }}>
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
              <div className={`pipe ${!state.pumping ? 'pipe-stopped' : ''}`}><div className={`pipe-flow ${isMainTankReducedFlow ? 'pipe-flow-slow' : ''}`}></div></div>
              <div className="col">
                <div className="tank-meter main-tank-meter">
                  <div
                    className="tank-outer main-tank-shell"
                    style={{ width: '108px', height: '114px', cursor: 'pointer' }}
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const pct = clamp((rect.bottom - event.clientY) / rect.height, 0, 1);
                      lastLocalUpdateRef.current = Date.now();
                      markMainTankDirty();
                      setState((prev) => {
                        const tank = Number((pct * 100).toFixed(1));
                        return applyMainTankRules({
                          ...prev,
                          tank,
                          mainTankManualOverride: null,
                        }, prev);
                      });
                    }}
                    title="Main tank pump follows tank level"
                  >
                    <div className="main-tank-cap"></div>
                    <div className="main-tank-body"></div>
                    <div className="main-tank-water-zone">
                      <AnimatedWaterFill height={`${mainTankFillPct.toFixed(1)}%`} />
                      <span className="main-tank-value">{Math.round(state.tank)}%</span>
                    </div>
                  </div>
                  <WaterScale ticks={mainTankScaleTicks} unit="" />
                </div>
                <span className="lbl">Tank</span>
              </div>
            </div>
            <div style={{ marginTop: '14px', borderTop: '0.5px solid #f1f5f9', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <div className="stat-row"><span style={{ fontSize: '20px', fontWeight: 700, color: '#64748b' }}>Flow rate</span><span style={{ fontSize: '22px', fontWeight: 500, color: '#0369a1' }}>{state.flowRate.toFixed(1)} L/min</span></div>
              <div className="stat-row"><span style={{ fontSize: '20px', fontWeight: 700, color: '#64748b' }}>Fill time</span><span style={{ fontSize: '22px', fontWeight: 500, color: '#0369a1' }}>{MAIN_TANK_FILL_TIME_MINUTES} min</span></div>
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
                    style={{ background: fanOn ? 'linear-gradient(180deg, #f0fdf4 0%, #dcfce7 100%)' : 'linear-gradient(180deg, #ffffff 0%, #eef3f8 100%)', boxShadow: fanOn ? '0 6px 16px rgba(13, 148, 136, 0.16)' : 'inset 0 1px 0 rgba(255,255,255,0.9)', cursor: 'pointer' }}
                    title="Fan turns on automatically when temperature is above 40 or humidity is above 70"
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
                    onClick={() => updateGreenhouse({ temp: clamp(Number((state.gh.temp - 1).toFixed(1)), 20, 60) })}
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
                    onClick={() => updateGreenhouse({ temp: clamp(Number((state.gh.temp + 1).toFixed(1)), 20, 60) })}
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
                    onClick={() => updateGreenhouse({ humidity: clamp(state.gh.humidity - 2, 30, 95) })}
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
                    onClick={() => updateGreenhouse({ humidity: clamp(state.gh.humidity + 2, 30, 95) })}
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
                  onClick={() => updateGreenhouse({ fireAlert: !fireOn })}
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
