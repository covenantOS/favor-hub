-- A meeting a FavorOS Tester hosts is always invited only, however it was made (new meeting, series, booking, a later edit).
-- The privacy canaries (ids c0ffee...) keep the access they are seeded with, because the privacy check reads them on purpose.
CREATE TRIGGER IF NOT EXISTS hub_meetings_tester_ins AFTER INSERT ON hub_meetings
WHEN lower(NEW.host_email) IN ('tester@favorintl.org', 'tester2@favorintl.org') AND NEW.access <> 'invited' AND NEW.id NOT LIKE 'c0ffee%'
BEGIN UPDATE hub_meetings SET access = 'invited' WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS hub_meetings_tester_upd AFTER UPDATE OF access, host_email ON hub_meetings
WHEN lower(NEW.host_email) IN ('tester@favorintl.org', 'tester2@favorintl.org') AND NEW.access <> 'invited' AND NEW.id NOT LIKE 'c0ffee%'
BEGIN UPDATE hub_meetings SET access = 'invited' WHERE id = NEW.id; END;
