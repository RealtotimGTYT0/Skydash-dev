-- The staff ladder, lowest to highest. Safe to run again: a rank that already exists is left exactly as it is.
-- They have no grant/revoke commands yet: set them with  /tokens admin rank setcmd <id> grant <command>
INSERT INTO "ranks" ("name", "display_name", "priority", "grant_commands", "revoke_commands") VALUES
  ('helper',     '<green>[Helper]</green>',                          10,  '{}', '{}'),
  ('head-helper','<dark_green>[Head Helper]</dark_green>',            20,  '{}', '{}'),
  ('mod',        '<aqua>[Mod]</aqua>',                               30,  '{}', '{}'),
  ('head-mod',   '<dark_aqua>[Head Mod]</dark_aqua>',                 40,  '{}', '{}'),
  ('staff',      '<yellow>[Staff]</yellow>',                         50,  '{}', '{}'),
  ('head-staff', '<gold>[Head Staff]</gold>',                        60,  '{}', '{}'),
  ('admin',      '<red>[Admin]</red>',                               70,  '{}', '{}'),
  ('head-admin', '<dark_red>[Head Admin]</dark_red>',                 80,  '{}', '{}'),
  ('dev',        '<light_purple>[Dev]</light_purple>',               90,  '{}', '{}'),
  ('owner',      '<bold><gold>[Owner]</gold></bold>',                100, '{}', '{}'),
  ('founder',    '<bold><gradient:#ffaa00:#ff5555>[Founder]</gradient></bold>', 110, '{}', '{}'),
  ('realtotim',  '<bold><rainbow>[Realtotim]</rainbow></bold>',      120, '{}', '{}')
ON CONFLICT ("name") DO NOTHING;
