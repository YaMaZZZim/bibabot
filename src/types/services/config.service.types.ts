export type Config = Record<ConfigProperty, boolean>;

export enum ConfigProperty {
  MEME_STAT = 'MEME_STAT',
  RENAME = 'RENAME',
  DAILY = 'DAILY',
  TRASH_REPLY = 'TRASH_REPLY',
}

export enum ConfigAction {
  TURN_ON = 'TURN_ON',
  TURN_OFF = 'TURN_OFF',
}

export const DEFAULT_CONFIG: Config = {
  MEME_STAT: false,
  RENAME: false,
  DAILY: true,
  TRASH_REPLY: true,
};

export enum ConfigPropertyDescription {
  MEME_STAT = 'Оценка мемов',
  RENAME = 'Автопереименование конфы',
  DAILY = 'Ежедневная биба',
  TRASH_REPLY = 'Интересные конкурсы',
}

// eslint-disable-next-line max-len
export const getPropertyDescription = (property: ConfigProperty): ConfigPropertyDescription => ConfigPropertyDescription[property] || 'Описания пока нет';
