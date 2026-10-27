import { APP_NAME } from '@gitroom/helpers/app-name';

export function LinkSelfLogin() {
  const url = process.env.LINKSELF_URL || process.env.NEXT_PUBLIC_LINKSELF_URL;
  if (!url) return null;
  return (
    <div className="flex flex-col gap-3">
      <a
        className="bg-forth text-white rounded-[4px] px-4 py-3 text-center font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        href={`${url.replace(/\/$/, '')}/dashboard/social`}
      >
        Continue with LinkSelf
      </a>
      <p className="text-sm">
        {APP_NAME} accounts are created from your LinkSelf account.
      </p>
    </div>
  );
}
