-- Track the plugin's DEVSCOPE_PRIVACY setting per session
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS privacy_mode TEXT;
