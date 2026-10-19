import { type MessageTree } from './fr.js';

export const en: MessageTree = {
  app: { name: 'Tesserax' },
  auth: {
    login: 'Sign in',
    logout: 'Sign out',
    email: 'Email address',
    password: 'Password',
    invalidCredentials: 'Invalid credentials',
    selectInstance: 'Choose a workspace',
  },
  validation: {
    required: 'This field is required',
    type: 'Invalid value',
    unknown_field: 'Unknown field',
    min_length: 'At least {{min}} characters',
    max_length: 'At most {{max}} characters',
    pattern: 'Invalid format',
    email: 'Invalid email address',
    phone: 'Invalid phone number',
    min: 'Minimum value: {{min}}',
    max: 'Maximum value: {{max}}',
    decimals: 'At most {{max}} decimal place(s)',
    step: 'Value in steps of {{step}}',
    integer: 'Whole number expected',
    option: 'Invalid choice',
    min_items: 'At least {{min}} item(s)',
    max_items: 'At most {{max}} item(s)',
    accuracy: 'GPS accuracy too low (max. {{max}} m)',
    min_rows: 'At least {{min}} row(s)',
    max_rows: 'At most {{max}} row(s)',
    read_only: 'Read-only field',
  },
  audit: {
    actions: {
      auth: {
        login: 'Sign-in',
        login_failed: 'Sign-in refused',
        client_token: 'API key token',
        client_token_failed: 'API key refused',
        password_change: 'Password changed',
      },
      apikey: {
        create: 'API key created',
        update: 'API key updated',
        secret: 'API key secret rotated',
        revoke: 'API key revoked',
      },
      user: {
        create: 'Member added',
        update: 'Member updated',
        remove: 'Member removed',
        password_reset: 'Password reset',
      },
      role: {
        create: 'Role created',
        update: 'Role updated',
        delete: 'Role deleted',
      },
      group: {
        create: 'Group created',
        update: 'Group renamed',
        delete: 'Group deleted',
        members: 'Group members updated',
      },
      settings: {
        update: 'Settings updated',
      },
      structure: {
        create: 'Form created',
        update: 'Form updated',
        delete: 'Form archived',
        publish: 'Form published',
        access: 'Form permissions updated',
      },
      list: {
        create: 'List created',
        update: 'List updated',
        delete: 'List deleted',
        import: 'List imported',
      },
      report: {
        create: 'Report template created',
        update: 'Report template updated',
        delete: 'Report template deleted',
        render: 'PDF report generated',
      },
      automation: {
        create: 'Automation created',
        update: 'Automation updated',
        delete: 'Automation deleted',
      },
      automation_run: {
        retry: 'Run retried',
      },
      webhook: {
        create: 'Webhook created',
        update: 'Webhook updated',
        delete: 'Webhook deleted',
        secret: 'Webhook secret rotated',
      },
      webhook_delivery: {
        retry: 'Webhook delivery retried',
      },
      email: {
        retry: 'E-mail resent',
      },
      dashboard: {
        create: 'Dashboard created',
        update: 'Dashboard updated',
        delete: 'Dashboard deleted',
      },
      submission: {
        export: 'Submissions export (spreadsheet)',
        photos_export: 'Photos export (ZIP)',
      },
      photo_export: {
        download: 'Photo archive downloaded',
      },
    },
  },
  common: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    loading: 'Loading…',
    offline: 'Offline',
  },
};
