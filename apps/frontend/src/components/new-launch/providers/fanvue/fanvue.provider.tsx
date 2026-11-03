'use client';

import { FC } from 'react';
import {
  PostComment,
  withProvider,
} from '@gitroom/frontend/components/new-launch/providers/high.order.provider';
import { GeneralPreviewComponent } from '@gitroom/frontend/components/launches/general.preview.component';
import { useSettings } from '@gitroom/frontend/components/launches/helpers/use.values';
import { FanvueDto } from '@gitroom/nestjs-libraries/dtos/posts/providers-settings/fanvue.dto';
import { Input } from '@gitroom/react/form/input';
import { Select } from '@gitroom/react/form/select';

const FanvueSettings: FC = () => {
  const form = useSettings();
  return (
    <div>
      <Select
        label="Audience"
        aria-label="Fanvue audience"
        {...form.register('audience')}
      >
        <option value="">Select audience</option>
        <option value="subscribers">Subscribers</option>
        <option value="followers-and-subscribers">
          Followers and subscribers
        </option>
      </Select>
      <Input
        label="Price in cents (optional, minimum 300; requires media)"
        aria-label="Fanvue post price in cents"
        type="number"
        min={300}
        step={1}
        {...form.register('price', {
          setValueAs: (value) => (value === '' ? undefined : Number(value)),
        })}
      />
    </div>
  );
};

const FanvuePreview: FC<{ maximumCharacters?: number }> = (props) => (
  <GeneralPreviewComponent {...props} />
);

export default withProvider({
  postComment: PostComment.POST,
  comments: false,
  minimumCharacters: [],
  SettingsComponent: FanvueSettings,
  CustomPreviewComponent: FanvuePreview,
  dto: FanvueDto,
  maximumCharacters: 5000,
});
