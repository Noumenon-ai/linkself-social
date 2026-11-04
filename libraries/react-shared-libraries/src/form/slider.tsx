'use client';

import { FC, useCallback } from 'react';
import clsx from 'clsx';
import { useVariables } from '@gitroom/react/helpers/variable.context';
export const Slider: FC<{
  value: 'on' | 'off';
  fill?: boolean;
  onChange: (value: 'on' | 'off') => void;
}> = (props) => {
  const { value, onChange, fill } = props;
  const { linkselfUrl } = useVariables();
  const change = useCallback(() => {
    onChange(value === 'on' ? 'off' : 'on');
  }, [value]);
  if (linkselfUrl) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={value === 'on'}
        aria-label={value === 'on' ? 'Enabled' : 'Disabled'}
        className="glass-switch"
        onClick={change}
      >
        <span className="glass-switch-thumb" />
      </button>
    );
  }
  return (
    <div
      className={clsx(
        'w-[57px] h-[34px] p-[4px] border-fifth border rounded-[100px]',
        value === 'on' && fill && 'bg-customColor4'
      )}
      onClick={change}
    >
      <div className="w-full h-full relative rounded-[100px]">
        <div
          className={clsx(
            'absolute left-0 top-0 w-[24px] h-[24px] bg-customColor5 rounded-full transition-all cursor-pointer',
            value === 'on' ? 'left-[100%] -translate-x-[100%]' : 'left-0'
          )}
        />
      </div>
    </div>
  );
};
