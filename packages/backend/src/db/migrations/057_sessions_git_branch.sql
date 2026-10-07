-- Git branch a session runs on, from the session.start payload, so the
-- topology can tell two sessions in the same project apart. Not stored for
-- `private` sessions. Updated on a later session.start (resume after a
-- checkout) and kept when that event has no branch.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS git_branch TEXT;
