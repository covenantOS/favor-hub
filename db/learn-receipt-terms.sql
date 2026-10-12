-- 2026-10-12: starter quiz wording. The printed mailing is a receipt; a thank-you letter is the HQTY letter.
UPDATE learn_lessons SET body = REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(body,
  'A letter you uncheck', 'A receipt you uncheck'),
  'After the letters print', 'After the receipts print'),
  'The letters print again', 'The receipts print again'),
  'Gifts that will not get a letter', 'Gifts that will not get a receipt'),
  'Letters already printed', 'Receipts already printed'),
  'It shows every letter on a picture', 'It shows every receipt on a picture'),
  'every letter lines up', 'every receipt lines up')
WHERE id IN ('les_c929fe2806d6f28eda0d2c4e', 'les_c9dea5479642440549cb61b6', 'les_f61d074c3fa3d711302469ba');
