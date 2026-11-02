import { FC, useCallback, useEffect, useState } from 'react';
import { useVariables } from '../helpers/variable.context';
import { HexColorPicker } from 'react-colorful';
import { useFormContext } from 'react-hook-form';
import { Button } from './button';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { TranslatedLabel } from '../translation/translated-label';

export const ColorPicker: FC<{
  name: string;
  label: string;
  enabled: boolean;
  onChange?: (params: {
    target: {
      name: string;
      value: string;
    };
  }) => void;
  value?: string;
  canBeCancelled: boolean;
  translationKey?: string;
  translationParams?: Record<string, string | number>;
}> = (props) => {
  const {
    name,
    label,
    enabled,
    value,
    canBeCancelled,
    onChange,
    translationKey,
    translationParams,
  } = props;
  const { linkselfUrl } = useVariables();
  const form = useFormContext();
  const color = onChange
    ? {
        onChange,
      }
    : form.register(name);
  const watch = onChange ? value : form.watch(name);
  const [colorDraft, setColorDraft] = useState(watch || '');
  useEffect(() => setColorDraft(watch || ''), [watch]);
  const validDraft = /^#[0-9a-f]{6}$/i.test(colorDraft);
  const [enabledState, setEnabledState] = useState(!!watch);
  const enable = useCallback(async () => {
    await color.onChange({
      target: {
        name,
        value: linkselfUrl ? '#FF7A45' : '#FFFFFF',
      },
    });
    setEnabledState(true);
  }, [linkselfUrl, color, name]);
  const cancel = useCallback(async () => {
    await color.onChange({
      target: {
        name,
        value: '',
      },
    });
    setEnabledState(false);
  }, []);

  const t = useT();

  if (!enabledState) {
    return (
      <div>
        <Button onClick={enable}>
          {t('enable_color_picker', 'Enable color picker')}
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-[6px]">
      <div>
        {!!label && (
          <div className={`text-[14px]`}>
            <TranslatedLabel
              label={label}
              translationKey={translationKey}
              translationParams={translationParams}
            />
          </div>
        )}
      </div>
      {canBeCancelled && (
        <div>
          <Button onClick={cancel}>
            {t('cancel_the_color_picker', 'Cancel the color picker')}
          </Button>
        </div>
      )}
      <div className="flex items-end gap-[20px]">
        <div>
          {linkselfUrl ? (
            <div className="flex flex-col gap-[6px]">
              <input
                aria-label={label}
                aria-invalid={!validDraft}
                value={colorDraft}
                maxLength={7}
                spellCheck={false}
                className="px-[12px] w-full"
                onChange={(event) => {
                  const next = event.target.value;
                  setColorDraft(next);
                  if (/^#[0-9a-f]{6}$/i.test(next)) {
                    color.onChange({ target: { name, value: next } });
                  }
                }}
                onBlur={() => setColorDraft(watch || '')}
              />
              {!validDraft && <p className="text-red-500 text-[13px]">{t('enter_hex_color', 'Enter a six-digit hex color, for example #FF7A45.')}</p>}
            </div>
          ) : <HexColorPicker
            color={watch}
            onChange={(value) =>
              color.onChange({
                target: {
                  name,
                  value,
                },
              })
            }
          />}
        </div>
        <div className="flex gap-[10px]">
          <div>
            <div
              className="w-[20px] h-[20px]"
              style={{
                backgroundColor: `var(--studio-marker, ${watch || 'transparent'})`,
              }}
            />
          </div>
          <div>{watch}</div>
        </div>
      </div>
    </div>
  );
};
