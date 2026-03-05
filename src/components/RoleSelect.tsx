import React from 'react';

interface Props {
  onOwner: () => void;
  onContractor: () => void;
}

export const RoleSelect: React.FC<Props> = ({ onOwner, onContractor }) => {
  return (
    <div className="min-h-screen bg-base-200 flex items-center justify-center p-4">
      <div className="card bg-base-100 shadow-xl w-full max-w-md">
        <div className="card-body items-center text-center">
          <div className="text-5xl mb-3">🌿</div>
          <h1 className="text-2xl font-bold">Troken LLC</h1>
          <p className="text-base-content/60 mb-6">Job Manager</p>

          <div className="flex flex-col gap-3 w-full max-w-xs">
            <button
              className="btn btn-primary btn-lg"
              onClick={onOwner}
            >
              🏢 Owner Dashboard
            </button>
            <button
              className="btn btn-outline btn-lg"
              onClick={onContractor}
            >
              👷 Contractor Login
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
