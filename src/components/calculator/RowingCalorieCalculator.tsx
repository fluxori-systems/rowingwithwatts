/**
 * Rowing Calorie Calculator
 *
 * FORMULA NOTES (research-validated, April 2025):
 *
 * Primary formula (MET-based):
 *   kcal = (MET × weight_kg × 3.5) / 200 × duration_mins
 *   • "3.5" = resting VO₂ in ml/kg/min (1 MET standard)
 *   • "200" = unit conversion collapsing ml→L (÷1000) and 5 kcal/L O₂ (×5)
 *   • Inherent accuracy: ±10–20% for average adults (Byrne et al., 2005)
 *
 * MET values — sourced from the 2024 Adult Compendium of Physical Activities
 * (Ainsworth et al., Journal of Sport and Health Science 2024, PMC10818145).
 * 82% of Compendium values are backed by indirect calorimetry (measured O₂).
 *   Light   (<100W):  5.0 MET  (Compendium code: rowing stationary, <100W)
 *   Moderate (100–149W): 7.5 MET (Compendium: 100–149W vigorous)
 *   Vigorous (150–199W): 11.0 MET (Compendium: 150–199W vigorous)
 *   Hard     (≥200W):   14.0 MET (Compendium: ≥200W very vigorous)
 *   Maximum  (racing):  15.5 MET (Compendium: 32+ spm racing speed)
 *
 * IMPORTANT — original developer's error: the earlier calculator used 8.5 MET
 * for vigorous rowing (150–199W). The 2024 Compendium measurement gives 11.0.
 * That was a 29% underestimate of calorie burn at threshold intensity.
 *
 * Concept2 weight-adjusted formula (used when split time is known):
 *   PM cal/hr  = (4 × watts × 0.8604) + 300
 *   Adj cal/hr = PM cal/hr − 300 + (1.714 × weight_lbs)
 *   kcal       = Adj cal/hr × (duration_mins / 60)
 *   Source: Concept2.sg official documentation; C2 Forum; exercise physiology consensus
 *
 * Split → watts formula (Concept2 flywheel physics, exact):
 *   watts = 2.80 / (split_sec / 500)³
 *   Derived from P = k × v³ (aerodynamic drag law; k calibrated to C2 flywheel)
 */

import { useState, useEffect, useRef } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

type WeightUnit = 'kg' | 'lbs';

interface Intensity {
  key: string;
  name: string;
  subtitle: string;
  /** 2024 Compendium of Physical Activities MET value */
  met: number;
  /** Approximate wattage range this level corresponds to */
  wattRange: string;
  mhrRange: string;
  spm: string;
  color: string;
  bg: string;
  border: string;
  description: string;
  icon: string;
}

interface Results {
  /** MET-formula calories */
  calories: number;
  /** Concept2 weight-adjusted calories (only when split provided) */
  caloriesC2: number | null;
  caloriesPerMin: number;
  caloriesPer500m: number;
  watts: number | null;
  estimatedSplitSec: number;
  intensity: Intensity;
  weightKg: number;
  durationMins: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Five intensity levels with MET values from the 2024 Compendium.
 * MHR ranges and SPM from Rowing With Watts training zones.
 */
const INTENSITIES: Intensity[] = [
  {
    key: 'light',
    name: 'Light',
    subtitle: 'Active Recovery',
    met: 5.0,
    wattRange: '< 100W',
    mhrRange: '55–70%',
    spm: '18–20',
    color: '#4ade80',
    bg: 'rgba(74, 222, 128, 0.08)',
    border: 'rgba(74, 222, 128, 0.3)',
    description: 'Easy paddling — warmup, cooldown, or low-intensity recovery rows',
    icon: '🌊',
  },
  {
    key: 'moderate',
    name: 'Moderate',
    subtitle: 'Endurance',
    met: 7.5,
    wattRange: '100–149W',
    mhrRange: '71–80%',
    spm: '20–24',
    color: '#facc15',
    bg: 'rgba(250, 204, 21, 0.08)',
    border: 'rgba(250, 204, 21, 0.3)',
    description: 'Conversational pace — sustainable for long steady-state sessions',
    icon: '💪',
  },
  {
    key: 'vigorous',
    name: 'Vigorous',
    subtitle: 'Anaerobic Threshold',
    met: 11.0,
    wattRange: '150–199W',
    mhrRange: '81–90%',
    spm: '24–28',
    color: '#fb923c',
    bg: 'rgba(249, 115, 22, 0.08)',
    border: 'rgba(249, 115, 22, 0.3)',
    description: 'Challenging but controlled — threshold training and tempo rows',
    icon: '🔥',
  },
  {
    key: 'hard',
    name: 'Hard',
    subtitle: 'VO₂ Max',
    met: 14.0,
    wattRange: '≥ 200W',
    mhrRange: '90–94%',
    spm: '28–32',
    color: '#f87171',
    bg: 'rgba(239, 68, 68, 0.08)',
    border: 'rgba(239, 68, 68, 0.3)',
    description: 'High-intensity intervals — very hard to sustain beyond a few minutes',
    icon: '⚡',
  },
  {
    key: 'maximum',
    name: 'Maximum',
    subtitle: 'Anaerobic',
    met: 15.5,
    wattRange: 'Racing',
    mhrRange: '95–100%',
    spm: '32+',
    color: '#c084fc',
    bg: 'rgba(192, 132, 252, 0.08)',
    border: 'rgba(192, 132, 252, 0.3)',
    description: 'All-out sprints — anaerobic effort, only sustainable for seconds',
    icon: '🚀',
  },
];

const FOOD_COMPS = [
  { label: 'pizza slices', emoji: '🍕', kcal: 285 },
  { label: 'bananas', emoji: '🍌', kcal: 89 },
  { label: 'cheeseburgers', emoji: '🍔', kcal: 535 },
  { label: 'cookies', emoji: '🍪', kcal: 78 },
  { label: 'cans of Coke', emoji: '🥤', kcal: 140 },
  { label: 'eggs', emoji: '🥚', kcal: 70 },
];

const ACTIVITY_COMPS = [
  { name: 'Running', met: 11.0, emoji: '🏃' },
  { name: 'Cycling', met: 8.0, emoji: '🚴' },
  { name: 'Swimming', met: 8.3, emoji: '🏊' },
  { name: 'Jump rope', met: 12.3, emoji: '🪢' },
];

// ─── Calculation helpers ───────────────────────────────────────────────────────

/**
 * MET formula (ACSM / 2024 Compendium standard):
 *   kcal = (MET × weight_kg × 3.5) / 200 × duration_mins
 * Inherent accuracy: ±10–20% for average adults.
 */
function calcCaloriesMET(met: number, weightKg: number, durationMins: number): number {
  return ((met * weightKg * 3.5) / 200) * durationMins;
}

/**
 * Concept2 weight-adjusted calorie formula.
 * More accurate than MET when actual power output is known.
 *
 *   PM cal/hr  = (4 × watts × 0.8604) + 300
 *   Adj cal/hr = PM cal/hr − 300 + (1.714 × weight_lbs)
 *   kcal       = Adj cal/hr × (duration_mins / 60)
 */
function calcCaloriesC2(watts: number, weightKg: number, durationMins: number): number {
  const weightLbs = weightKg * 2.20462;
  const pmCalPerHr = 4 * watts * 0.8604 + 300;
  const adjCalPerHr = pmCalPerHr - 300 + 1.714 * weightLbs;
  return adjCalPerHr * (durationMins / 60);
}

/**
 * Concept2 flywheel physics: P = k × v³
 * k = 2.80 (calibrated to C2 RowErg flywheel geometry)
 */
function splitToWatts(splitSec: number): number {
  return 2.8 / Math.pow(splitSec / 500, 3);
}

/**
 * Estimate 500m split from MET — calibrated so MET 7.5 ≈ 120s (2:00/500m).
 * Uses the cubic relationship from fluid dynamics (watts ∝ 1/split³).
 */
function metToEstimatedSplit(met: number): number {
  // Anchor: MET 7.5 → 120s/500m; scale using watts ∝ MET (approx linear over narrow range)
  return Math.round(120 * Math.pow(7.5 / met, 1 / 3));
}

/** Parse "M:SS" → seconds, or null if invalid */
function parseSplit(s: string): number | null {
  const m = s.match(/^(\d+):(\d{1,2})$/);
  if (!m) return null;
  const mins = parseInt(m[1], 10);
  const secs = parseInt(m[2], 10);
  if (secs >= 60) return null;
  return mins * 60 + secs;
}

function fmtSplit(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ─── Count-up animation hook ──────────────────────────────────────────────────

function useCountUp(target: number, duration = 1100) {
  const [value, setValue] = useState(0);
  const raf = useRef<number | null>(null);
  const t0 = useRef<number | null>(null);
  const from = useRef(0);

  useEffect(() => {
    from.current = value;
    t0.current = null;

    const animate = (ts: number) => {
      if (!t0.current) t0.current = ts;
      const p = Math.min((ts - t0.current) / duration, 1);
      const ease = 1 - Math.pow(1 - p, 3); // cubic ease-out
      setValue(Math.round(from.current + (target - from.current) * ease));
      if (p < 1) raf.current = requestAnimationFrame(animate);
    };

    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(animate);

    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  return value;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  unit,
  accent,
  sub,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
  sub?: string;
}) {
  return (
    <div
      style={{
        padding: '0.875rem',
        background: accent ? 'rgba(212,80,30,0.1)' : 'rgba(255,255,255,0.05)',
        border: `1px solid ${accent ? 'rgba(212,80,30,0.35)' : 'rgba(255,255,255,0.09)'}`,
        borderRadius: '10px',
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: '1.375rem',
          fontWeight: 800,
          color: accent ? '#D4501E' : '#fff',
          lineHeight: 1,
          letterSpacing: '-0.01em',
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '0.25rem' }}>{unit}</div>
      <div style={{ fontSize: '0.65rem', color: '#64748b', marginTop: '0.125rem' }}>{label}</div>
      {sub && (
        <div style={{ fontSize: '0.6rem', color: '#475569', marginTop: '0.125rem' }}>{sub}</div>
      )}
    </div>
  );
}

function ActivityBar({
  emoji,
  name,
  calories,
  barWidth,
  barColor,
  labelColor,
  bold,
}: {
  emoji: string;
  name: string;
  calories: number;
  barWidth: number;
  barColor: string;
  labelColor: string;
  bold?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', marginBottom: '0.5rem' }}>
      <span style={{ fontSize: '1rem', width: '1.375rem', textAlign: 'center', flexShrink: 0 }}>
        {emoji}
      </span>
      <span
        style={{
          fontSize: '0.8rem',
          color: labelColor,
          width: '5rem',
          minWidth: 0,
          flexShrink: 1,
          fontWeight: bold ? 700 : 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {name}
      </span>
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div
          style={{
            height: '5px',
            background: 'rgba(255,255,255,0.07)',
            borderRadius: '3px',
            flex: 1,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(Math.max(barWidth, 0), 100)}%`,
              background: barColor,
              borderRadius: '3px',
              transition: 'width 0.5s ease',
            }}
          />
        </div>
        <span
          style={{
            fontSize: '0.775rem',
            color: labelColor,
            fontWeight: bold ? 700 : 600,
            width: '3.75rem',
            textAlign: 'right',
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {calories.toLocaleString()} cal
        </span>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function RowingCalorieCalculator() {
  const [weight, setWeight] = useState('75');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [intensity, setIntensity] = useState<Intensity>(INTENSITIES[1]);
  const [duration, setDuration] = useState(30);
  const [splitInput, setSplitInput] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [sessionsPerWeek, setSessionsPerWeek] = useState(3);
  const [results, setResults] = useState<Results | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Animated counter targets the displayed calories
  const displayCalories = results
    ? results.caloriesC2 !== null
      ? Math.round(results.caloriesC2)
      : results.calories
    : 0;
  const animatedCalories = useCountUp(displayCalories);

  const toggleUnit = (u: WeightUnit) => {
    if (u === unit) return;
    const v = parseFloat(weight);
    if (!isNaN(v)) {
      setWeight(u === 'lbs' ? (v * 2.20462).toFixed(1) : (v / 2.20462).toFixed(1));
    }
    setUnit(u);
    setErrors({});
  };

  const validate = (): boolean => {
    const errs: Record<string, string> = {};
    const v = parseFloat(weight);
    if (isNaN(v) || v <= 0) {
      errs.weight = 'Please enter a valid weight.';
    } else if (unit === 'kg' && (v < 20 || v > 300)) {
      errs.weight = 'Enter a weight between 20–300 kg.';
    } else if (unit === 'lbs' && (v < 44 || v > 660)) {
      errs.weight = 'Enter a weight between 44–660 lbs.';
    }

    if (splitInput.trim()) {
      const sec = parseSplit(splitInput.trim());
      if (sec === null) {
        errs.split = 'Use M:SS format, e.g. 2:00';
      } else if (sec < 60 || sec > 600) {
        errs.split = 'Split should be between 1:00 and 10:00';
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const calculate = () => {
    if (!validate()) return;
    setCalculating(true);

    setTimeout(() => {
      const wRaw = parseFloat(weight);
      const weightKg = unit === 'lbs' ? wRaw / 2.20462 : wRaw;

      // MET estimate (always computed)
      const calMET = Math.round(calcCaloriesMET(intensity.met, weightKg, duration));
      const calPerMin = calMET / duration;

      // Concept2 weight-adjusted estimate (only when split provided)
      let splitSec: number | null = null;
      let watts: number | null = null;
      let calC2: number | null = null;

      if (splitInput.trim()) {
        splitSec = parseSplit(splitInput.trim());
        if (splitSec) {
          watts = Math.round(splitToWatts(splitSec));
          calC2 = Math.round(calcCaloriesC2(watts, weightKg, duration));
        }
      }

      const estimatedSplitSec = splitSec ?? metToEstimatedSplit(intensity.met);
      const calPer500m = calPerMin * (estimatedSplitSec / 60);

      setResults({
        calories: calMET,
        caloriesC2: calC2,
        caloriesPerMin: calPerMin,
        caloriesPer500m: calPer500m,
        watts,
        estimatedSplitSec,
        intensity,
        weightKg,
        durationMins: duration,
      });
      setCalculating(false);
    }, 380);
  };

  const weeklyCalories = results ? displayCalories * sessionsPerWeek : 0;
  const monthlyCalories = Math.round(weeklyCalories * 4.33);

  // ── Shared style objects ──────────────────────────────────────────────────

  const s = {
    card: {
      background: 'linear-gradient(160deg, #0d1a35 0%, #152040 60%, #1a2a50 100%)',
      borderRadius: '18px',
      padding: 'clamp(1.25rem, 4vw, 2rem)',
      color: '#f1f5f9',
      fontFamily: 'Inter Variable, Inter, system-ui, sans-serif',
      maxWidth: '680px',
      margin: '2.5rem auto',
      boxShadow: '0 24px 64px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.07)',
      position: 'relative' as const,
      overflow: 'hidden',
    },
    label: {
      display: 'block',
      fontSize: '0.8rem',
      fontWeight: 600,
      color: '#94a3b8',
      letterSpacing: '0.05em',
      textTransform: 'uppercase' as const,
      marginBottom: '0.625rem',
    },
    inputBase: {
      background: 'rgba(255,255,255,0.07)',
      border: '1.5px solid rgba(255,255,255,0.12)',
      borderRadius: '10px',
      padding: '0.75rem 1rem',
      color: '#fff',
      fontSize: '1rem',
      fontWeight: 600,
      outline: 'none',
      width: '100%',
      boxSizing: 'border-box' as const,
    },
    section: {
      padding: '1.125rem',
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: '12px',
      marginBottom: '0.875rem',
      overflow: 'hidden',
    },
    sectionTitle: {
      margin: '0 0 0.875rem',
      fontSize: '0.725rem',
      fontWeight: 700,
      color: '#64748b',
      textTransform: 'uppercase' as const,
      letterSpacing: '0.07em',
    },
  };

  return (
    <div style={s.card}>
      {/* Background glow */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: '-60px',
          right: '-60px',
          width: '260px',
          height: '260px',
          background: 'radial-gradient(circle, rgba(212,80,30,0.1) 0%, transparent 70%)',
          pointerEvents: 'none',
        }}
      />

      {/* Header */}
      <div style={{ textAlign: 'center', marginBottom: '1.75rem', position: 'relative' }}>
        <div style={{ fontSize: '2.25rem', lineHeight: 1, marginBottom: '0.5rem' }}>🚣</div>
        <h2
          style={{
            fontSize: 'clamp(1.25rem, 4vw, 1.625rem)',
            fontWeight: 800,
            margin: 0,
            color: '#fff',
            letterSpacing: '-0.02em',
          }}
        >
          Rowing Calorie Calculator
        </h2>
        <p style={{ fontSize: '0.8rem', color: '#475569', marginTop: '0.375rem', marginBottom: 0 }}>
          2024 Compendium of Physical Activities · Concept2 weight-adjusted formula
        </p>
      </div>

      {/* ── Weight ──────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.375rem' }}>
        <span style={s.label}>Body Weight</span>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <div style={{ flex: 1 }}>
            <input
              type="number"
              value={weight}
              onChange={(e) => {
                setWeight(e.target.value);
                if (results) setResults(null);
              }}
              style={{
                ...s.inputBase,
                borderColor: errors.weight ? '#ef4444' : 'rgba(255,255,255,0.12)',
                fontSize: '1.125rem',
              }}
              placeholder={unit === 'kg' ? '75' : '165'}
              min={unit === 'kg' ? 20 : 44}
              max={unit === 'kg' ? 300 : 660}
              aria-label="Body weight"
            />
          </div>
          <div
            style={{
              display: 'flex',
              background: 'rgba(255,255,255,0.07)',
              border: '1.5px solid rgba(255,255,255,0.12)',
              borderRadius: '10px',
              overflow: 'hidden',
              flexShrink: 0,
            }}
          >
            {(['kg', 'lbs'] as WeightUnit[]).map((u) => (
              <button
                key={u}
                onClick={() => toggleUnit(u)}
                style={{
                  padding: '0 1.125rem',
                  border: 'none',
                  background: unit === u ? 'rgba(212,80,30,0.85)' : 'transparent',
                  color: unit === u ? '#fff' : '#64748b',
                  fontWeight: unit === u ? 700 : 500,
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  transition: 'all 0.18s',
                  fontFamily: 'inherit',
                }}
              >
                {u}
              </button>
            ))}
          </div>
        </div>
        {errors.weight && (
          <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.375rem' }}>
            {errors.weight}
          </p>
        )}
      </div>

      {/* ── Intensity selector ───────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.375rem' }}>
        <span style={s.label}>Rowing Intensity</span>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
          {INTENSITIES.map((lvl) => {
            const active = intensity.key === lvl.key;
            return (
              <button
                key={lvl.key}
                onClick={() => {
                  setIntensity(lvl);
                  if (results) setResults(null);
                }}
                aria-pressed={active}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.7rem 0.875rem',
                  background: active ? lvl.bg : 'rgba(255,255,255,0.03)',
                  border: `1.5px solid ${active ? lvl.border : 'rgba(255,255,255,0.07)'}`,
                  borderRadius: '10px',
                  cursor: 'pointer',
                  color: '#fff',
                  textAlign: 'left',
                  width: '100%',
                  transition: 'all 0.15s ease',
                  fontFamily: 'inherit',
                }}
              >
                {/* Accent strip */}
                <div
                  style={{
                    width: '4px',
                    height: '34px',
                    borderRadius: '2px',
                    background: active ? lvl.color : 'rgba(255,255,255,0.12)',
                    flexShrink: 0,
                    transition: 'background 0.15s',
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      flexWrap: 'wrap',
                    }}
                  >
                    <span style={{ fontSize: '0.9375rem' }}>{lvl.icon}</span>
                    <span style={{ fontWeight: 700, fontSize: '0.9375rem' }}>{lvl.name}</span>
                    <span
                      style={{
                        fontSize: '0.675rem',
                        background: active ? lvl.bg : 'rgba(255,255,255,0.07)',
                        border: `1px solid ${active ? lvl.border : 'rgba(255,255,255,0.1)'}`,
                        color: active ? lvl.color : '#94a3b8',
                        padding: '0.1rem 0.45rem',
                        borderRadius: '999px',
                        fontWeight: 600,
                        transition: 'all 0.15s',
                      }}
                    >
                      {lvl.subtitle}
                    </span>
                  </div>
                  <p
                    style={{
                      margin: '0.1rem 0 0',
                      fontSize: '0.75rem',
                      color: active ? '#94a3b8' : '#475569',
                      transition: 'color 0.15s',
                    }}
                  >
                    {lvl.description}
                  </p>
                </div>
                <div style={{ textAlign: 'right', flexShrink: 0 }}>
                  <div style={{ fontSize: '0.7rem', color: active ? '#94a3b8' : '#475569', fontWeight: 600 }}>
                    MET {lvl.met}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#475569' }}>
                    {lvl.mhrRange} MHR
                  </div>
                  <div style={{ fontSize: '0.65rem', color: '#475569' }}>{lvl.spm} SPM</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Duration ─────────────────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.375rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '0.625rem',
          }}
        >
          <span style={s.label}>Duration</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
            <input
              type="number"
              value={duration}
              onChange={(e) => {
                const v = Math.min(120, Math.max(1, parseInt(e.target.value) || 1));
                setDuration(v);
                if (results) setResults(null);
              }}
              style={{
                width: '3.5rem',
                background: 'rgba(255,255,255,0.07)',
                border: '1.5px solid rgba(255,255,255,0.12)',
                borderRadius: '7px',
                padding: '0.25rem 0.375rem',
                color: '#fff',
                fontSize: '1rem',
                fontWeight: 700,
                textAlign: 'center',
                outline: 'none',
                fontFamily: 'inherit',
              }}
              min={1}
              max={120}
              aria-label="Duration in minutes"
            />
            <span style={{ color: '#64748b', fontSize: '0.875rem' }}>min</span>
          </div>
        </div>
        <input
          type="range"
          min={1}
          max={120}
          value={duration}
          onChange={(e) => {
            setDuration(parseInt(e.target.value));
            if (results) setResults(null);
          }}
          style={{ width: '100%', maxWidth: '100%', boxSizing: 'border-box', display: 'block', accentColor: '#D4501E', cursor: 'pointer' }}
          aria-label="Duration slider"
        />
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontSize: '0.675rem',
            color: '#475569',
            marginTop: '0.25rem',
          }}
        >
          <span>1 min</span>
          <span>60 min</span>
          <span>120 min</span>
        </div>
      </div>

      {/* ── Advanced: split time ──────────────────────────────────────────────── */}
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          style={{
            background: 'none',
            border: 'none',
            color: '#64748b',
            fontSize: '0.8rem',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.375rem',
            padding: 0,
            fontFamily: 'inherit',
            transition: 'color 0.15s',
          }}
        >
          <span
            style={{
              display: 'inline-block',
              transform: showAdvanced ? 'rotate(90deg)' : 'none',
              transition: 'transform 0.2s',
              fontSize: '0.6rem',
            }}
          >
            ▶
          </span>
          Optional: add your 500m split for a more accurate Concept2 calculation
        </button>

        {showAdvanced && (
          <div style={{ marginTop: '0.875rem' }}>
            <span style={s.label}>Average 500m Split</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <input
                type="text"
                value={splitInput}
                onChange={(e) => setSplitInput(e.target.value)}
                placeholder="2:00"
                style={{
                  width: '6.5rem',
                  background: 'rgba(255,255,255,0.07)',
                  border: `1.5px solid ${errors.split ? '#ef4444' : 'rgba(255,255,255,0.12)'}`,
                  borderRadius: '10px',
                  padding: '0.625rem 0.875rem',
                  color: '#fff',
                  fontSize: '1.125rem',
                  fontWeight: 700,
                  textAlign: 'center',
                  outline: 'none',
                  fontFamily: 'JetBrains Mono Variable, JetBrains Mono, monospace',
                  letterSpacing: '0.05em',
                }}
                aria-label="500m split time"
              />
              <span style={{ color: '#475569', fontSize: '0.8rem' }}>per 500m (M:SS format)</span>
            </div>
            {errors.split && (
              <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '0.375rem' }}>
                {errors.split}
              </p>
            )}
            <p style={{ color: '#475569', fontSize: '0.7rem', marginTop: '0.5rem', lineHeight: 1.5 }}>
              Unlocks the Concept2 weight-adjusted formula — more accurate than MET for ergs.
              Uses watts = 2.80 ÷ (split/500)³ (Concept2 flywheel physics).
            </p>
          </div>
        )}
      </div>

      {/* ── Calculate button ─────────────────────────────────────────────────── */}
      <button
        onClick={calculate}
        disabled={calculating}
        style={{
          width: '100%',
          padding: '1rem',
          background: calculating
            ? 'rgba(196,69,24,0.5)'
            : 'linear-gradient(135deg, #D4501E 0%, #C44518 100%)',
          border: 'none',
          borderRadius: '12px',
          color: '#fff',
          fontSize: '1rem',
          fontWeight: 700,
          cursor: calculating ? 'wait' : 'pointer',
          letterSpacing: '0.03em',
          transition: 'all 0.2s',
          boxShadow: calculating ? 'none' : '0 6px 24px rgba(212,80,30,0.4)',
          fontFamily: 'inherit',
        }}
      >
        {calculating ? 'Calculating…' : '⚡ Calculate Calories Burned'}
      </button>

      {/* ── Results ──────────────────────────────────────────────────────────── */}
      {results && (
        <div style={{ marginTop: '2rem' }}>
          {/* Divider */}
          <div
            style={{
              height: '1px',
              background:
                'linear-gradient(90deg, transparent 0%, rgba(212,80,30,0.5) 50%, transparent 100%)',
              marginBottom: '1.75rem',
            }}
          />

          {/* ── Big calorie number ─────────────────────────────────────────── */}
          <div
            style={{
              textAlign: 'center',
              padding: 'clamp(1.25rem, 4vw, 2rem)',
              background: 'rgba(212,80,30,0.08)',
              border: '1px solid rgba(212,80,30,0.22)',
              borderRadius: '14px',
              marginBottom: '0.875rem',
            }}
          >
            <p
              style={{
                margin: '0 0 0.375rem',
                fontSize: '0.7rem',
                color: '#64748b',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
                fontWeight: 600,
              }}
            >
              {results.caloriesC2 !== null ? 'Calories Burned (Concept2 method)' : 'Calories Burned (MET method)'}
            </p>
            <div
              style={{
                fontSize: 'clamp(3.5rem, 14vw, 5.5rem)',
                fontWeight: 900,
                color: '#D4501E',
                lineHeight: 1,
                letterSpacing: '-0.03em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {animatedCalories.toLocaleString()}
            </div>
            <p style={{ margin: '0.375rem 0 0', fontSize: '0.875rem', color: '#64748b' }}>
              kilocalories
            </p>

            {/* Show both methods when split is given */}
            {results.caloriesC2 !== null && (
              <p
                style={{
                  margin: '0.625rem 0 0',
                  fontSize: '0.75rem',
                  color: '#475569',
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '6px',
                  padding: '0.375rem 0.75rem',
                  display: 'inline-block',
                }}
              >
                MET estimate: {results.calories.toLocaleString()} kcal
              </p>
            )}

            <p style={{ margin: '0.625rem 0 0', fontSize: '0.775rem', color: '#475569' }}>
              {results.durationMins} min ·{' '}
              <span style={{ color: results.intensity.color }}>
                {results.intensity.name} ({results.intensity.subtitle})
              </span>{' '}
              · {unit === 'kg' ? `${weight} kg` : `${weight} lbs`}
            </p>
          </div>

          {/* ── Stats grid ────────────────────────────────────────────────────── */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: results.watts ? 'repeat(auto-fit, minmax(90px, 1fr))' : 'repeat(2,1fr)',
              gap: '0.625rem',
              marginBottom: '0.875rem',
            }}
          >
            <StatCard
              label="Per minute"
              value={results.caloriesPerMin.toFixed(1)}
              unit="cal / min"
            />
            <StatCard
              label={`Per 500m${results.watts ? '' : ' (est.)'}`}
              value={results.caloriesPer500m.toFixed(1)}
              unit="cal / 500m"
            />
            {results.watts && (
              <StatCard
                label="Power output"
                value={String(results.watts)}
                unit="watts"
                accent
                sub={`~${fmtSplit(results.estimatedSplitSec)}/500m`}
              />
            )}
          </div>

          {/* ── Intensity meter ───────────────────────────────────────────────── */}
          <div
            style={{
              ...s.section,
              display: 'flex',
              alignItems: 'center',
              gap: '0.875rem',
              padding: '0.875rem 1rem',
            }}
          >
            <div
              style={{
                width: '5px',
                height: '44px',
                borderRadius: '3px',
                background: results.intensity.color,
                flexShrink: 0,
              }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontWeight: 700,
                  fontSize: '0.875rem',
                  color: results.intensity.color,
                }}
              >
                {results.intensity.name} · {results.intensity.subtitle}
              </div>
              <div style={{ fontSize: '0.7rem', color: '#64748b', marginTop: '0.125rem' }}>
                MET {results.intensity.met} · {results.intensity.mhrRange} MHR ·{' '}
                {results.intensity.spm} SPM ·{' '}
                {results.watts
                  ? `${results.watts}W measured`
                  : `~${fmtSplit(results.estimatedSplitSec)}/500m est.`}
              </div>
            </div>
            <div style={{ flexShrink: 0, width: '80px' }}>
              <div
                style={{
                  height: '6px',
                  background: 'rgba(255,255,255,0.08)',
                  borderRadius: '3px',
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${(results.intensity.met / 15.5) * 100}%`,
                    background: `linear-gradient(90deg, ${results.intensity.color}55, ${results.intensity.color})`,
                    borderRadius: '3px',
                    transition: 'width 0.6s ease',
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: '0.6rem',
                  color: '#475569',
                  marginTop: '0.25rem',
                  textAlign: 'right',
                }}
              >
                Intensity
              </div>
            </div>
          </div>

          {/* ── Food equivalents ──────────────────────────────────────────────── */}
          <div style={s.section}>
            <p style={s.sectionTitle}>That burns off…</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
              {FOOD_COMPS.map((f) => {
                const qty = displayCalories / f.kcal;
                if (qty < 0.4) return null;
                const display = qty >= 10 ? Math.round(qty).toString() : qty.toFixed(1);
                return (
                  <div
                    key={f.label}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.375rem',
                      background: 'rgba(255,255,255,0.06)',
                      border: '1px solid rgba(255,255,255,0.08)',
                      borderRadius: '8px',
                      padding: '0.45rem 0.75rem',
                    }}
                  >
                    <span style={{ fontSize: '1rem' }}>{f.emoji}</span>
                    <span style={{ fontWeight: 800, color: '#fff', fontSize: '0.9375rem' }}>
                      {display}
                    </span>
                    <span style={{ color: '#64748b', fontSize: '0.725rem' }}>{f.label}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Activity comparisons ──────────────────────────────────────────── */}
          <div style={s.section}>
            <p style={s.sectionTitle}>vs. other activities (same duration)</p>

            <ActivityBar
              emoji="🚣"
              name="Rowing"
              calories={displayCalories}
              barWidth={80}
              barColor="#D4501E"
              labelColor="#D4501E"
              bold
            />

            {ACTIVITY_COMPS.map((a) => {
              const aCal = Math.round(
                calcCaloriesMET(a.met, results.weightKg, results.durationMins),
              );
              const ratio = aCal / displayCalories;
              return (
                <ActivityBar
                  key={a.name}
                  emoji={a.emoji}
                  name={a.name}
                  calories={aCal}
                  barWidth={ratio * 80}
                  barColor={ratio > 1 ? '#4ade80' : '#64748b'}
                  labelColor={ratio > 1 ? '#4ade80' : '#94a3b8'}
                />
              );
            })}
          </div>

          {/* ── Weekly projection ─────────────────────────────────────────────── */}
          <div style={s.section}>
            <p style={s.sectionTitle}>Weekly &amp; Monthly Projection</p>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                marginBottom: '1rem',
                overflow: 'hidden',
              }}
            >
              <span style={{ fontSize: '0.825rem', color: '#94a3b8', whiteSpace: 'nowrap', flexShrink: 0 }}>
                Sessions/wk:
              </span>
              <input
                type="range"
                min={1}
                max={7}
                value={sessionsPerWeek}
                onChange={(e) => setSessionsPerWeek(parseInt(e.target.value))}
                style={{ flex: 1, minWidth: 0, width: '100%', maxWidth: '100%', boxSizing: 'border-box', accentColor: '#D4501E', display: 'block' }}
                aria-label="Sessions per week"
              />
              <span
                style={{
                  fontSize: '1.125rem',
                  fontWeight: 800,
                  color: '#fff',
                  minWidth: '2rem',
                  textAlign: 'center',
                }}
              >
                {sessionsPerWeek}×
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
              <div
                style={{
                  padding: '1rem',
                  background: 'rgba(255,255,255,0.05)',
                  borderRadius: '10px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: '1.625rem',
                    fontWeight: 800,
                    color: '#fff',
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {weeklyCalories.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '0.25rem' }}>
                  calories per week
                </div>
              </div>
              <div
                style={{
                  padding: '1rem',
                  background: 'rgba(212,80,30,0.1)',
                  border: '1px solid rgba(212,80,30,0.22)',
                  borderRadius: '10px',
                  textAlign: 'center',
                }}
              >
                <div
                  style={{
                    fontSize: '1.625rem',
                    fontWeight: 800,
                    color: '#D4501E',
                    lineHeight: 1,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {monthlyCalories.toLocaleString()}
                </div>
                <div style={{ fontSize: '0.725rem', color: '#64748b', marginTop: '0.25rem' }}>
                  calories per month
                </div>
              </div>
            </div>

            {monthlyCalories >= 3500 && (
              <p
                style={{
                  fontSize: '0.7rem',
                  color: '#475569',
                  marginTop: '0.75rem',
                  textAlign: 'center',
                  lineHeight: 1.5,
                }}
              >
                ≈ {(monthlyCalories / 7700).toFixed(1)} kg fat equivalent per month
                <br />
                <span style={{ fontSize: '0.625rem' }}>(~7,700 kcal per kg of body fat)</span>
              </p>
            )}
          </div>

          {/* ── Accuracy note ─────────────────────────────────────────────────── */}
          <div
            style={{
              padding: '0.875rem 1rem',
              background: 'rgba(255,255,255,0.03)',
              border: '1px solid rgba(255,255,255,0.07)',
              borderRadius: '10px',
              fontSize: '0.7rem',
              color: '#475569',
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: '#64748b' }}>About accuracy:</strong> MET estimates carry
            ±10–20% inherent error (Byrne et al., 2005). The Concept2 weight-adjusted formula
            (shown when split is provided) is more precise. Neither method accounts for
            post-exercise calorie burn (EPOC), which adds 6–15% for vigorous sessions.
            MET values from the 2024 Compendium of Physical Activities.
          </div>
        </div>
      )}
    </div>
  );
}
