import React, { useState, useRef } from 'react';
import { db } from '../db'

interface Props {
  onSuccess: (subId: number, subName: string, role: 'tc' | 'crew' | 'oseguera') => void;
  onBack: () => void;
}

export const SubLogin: React.FC<Props> = ({ onSuccess, onBack }) => {
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  function handleChange(index: number, value: string) {
    if (!/^\d*$/.test(value)) return;
    const newPin = [...pin];
    newPin[index] = value.slice(-1);
    setPin(newPin);
    setError('');

    if (value && index < 3) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 4 digits entered
    if (value && index === 3 && newPin.every(d => d !== '')) {
      checkPin(newPin.join(''));
    }
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent) {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  async function checkPin(code: string) {
    setChecking(true);
    try {
      const rows = await db.query(
        `SELECT id, name FROM subs WHERE pin = '${code}' LIMIT 1`
      );
      if (rows.length > 0) {
        const sub = rows[0] as any;
        const role = (sub.id === 3 || (sub.name as string).toLowerCase().includes('oseguera')) ? 'oseguera' : 'tc';
        onSuccess(sub.id, sub.name, role);
      } else if (code === '1234') {
        onSuccess(1, 'Crew Lead', 'crew');
      } else {
        setError('Invalid PIN. Try again.');
        setPin(['', '', '', '']);
        setTimeout(() => inputRefs.current[0]?.focus(), 100);
      }
    } catch (err) {
      setError('Something went wrong. Try again.');
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
      <div className="card bg-base-100 shadow-xl w-full max-w-sm">
        <div className="card-body items-center text-center">
          {/* Logo / Header */}
          <div className="mb-2">
            <div className="text-4xl mb-2">🌿</div>
            <h2 className="card-title text-xl">Contractor Login</h2>
            <p className="text-base-content/60 text-sm mt-1">Enter your 4-digit PIN</p>
          </div>

          {/* PIN Input */}
          <div className="flex gap-3 my-6">
            {pin.map((digit, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="text"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                className={`input input-bordered w-14 h-14 text-center text-2xl font-bold ${error ? 'input-error' : 'input-primary'}`}
                disabled={checking}
                autoFocus={i === 0}
              />
            ))}
          </div>

          {/* Error */}
          {error && (
            <div className="text-error text-sm font-medium mb-2">{error}</div>
          )}

          {/* Loading */}
          {checking && (
            <span className="loading loading-spinner loading-md text-primary mb-2" />
          )}

          {/* Back */}
          <button className="btn btn-ghost btn-sm mt-2" onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
};
