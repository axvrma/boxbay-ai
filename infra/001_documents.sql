CREATE TABLE IF NOT EXISTS documents (
  kind varchar(20) NOT NULL,
  id varchar(64) NOT NULL,
  version integer NOT NULL,
  body json NOT NULL,
  PRIMARY KEY (kind, id, version)
);
