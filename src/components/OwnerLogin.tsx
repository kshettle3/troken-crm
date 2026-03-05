import React, { useState, useRef } from 'react';

const OWNER_PIN = '6192';

interface Props {
  onSuccess: () => void;
  onBack: () => void;
}

export const OwnerLogin: React.FC<Props> = ({ onSuccess, onBack }) => {
  const [pin, setPin] = useState(['', '', '', '']);
  const [error, setError] = useState('');
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

  function checkPin(code: string) {
    if (code === OWNER_PIN) {
      onSuccess();
    } else {
      setError('Invalid PIN. Try again.');
      setPin(['', '', '', '']);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    }
  }

  return (
    <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
      <div className="card bg-base-100 shadow-xl w-full max-w-sm">
        <div className="card-body items-center text-center">
          <div className="mb-2">
            <div className="text-4xl mb-2">🌿</div>
            <h2 className="card-title text-xl">Owner Login</h2>
            <p className="text-base-content/60 text-sm mt-1">Enter your 4-digit PIN</p>
          </div>

          <div className="flex gap-3 my-6">
            {pin.map((digit, i) => (
              <input
                key={i}
                ref={el => { inputRefs.current[i] = el; }}
                type="password"
                inputMode="numeric"
                maxLength={1}
                value={digit}
                onChange={e => handleChange(i, e.target.value)}
                onKeyDown={e => handleKeyDown(i, e)}
                className={`input input-bordered w-14 h-14 text-center text-2xl font-bold ${error ? 'input-error' : 'input-primary'}`}
                autoFocus={i === 0}
              />
            ))}
          </div>

          {error && (
            <div className="text-error text-sm font-medium mb-2">{error}</div>
          )}

          <button className="btn btn-ghost btn-sm mt-2" onClick={onBack}>
            ← Back
          </button>
        </div>
      </div>
    </div>
  );
};
