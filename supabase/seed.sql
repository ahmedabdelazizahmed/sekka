-- Sekka — starter catalogue: company profile, universities, lines, stops and time slots.
-- Everything here is fictional demo data except the university names, which are used only as destinations.
insert into public.company_settings (id, name_ar, name_en, tagline_ar, tagline_en, phone, whatsapp, owner_phone,
  term_code, term_name_ar, term_name_en, term_start, term_end, next_term_code, next_term_name_ar, next_term_name_en, next_term_start, next_term_end,
  demo_mode, payment_note_ar, payment_note_en, site_url)
values (1, 'سكّة', 'Sekka', 'مواصلات جامعية مضمونة وفي معادها', 'Reliable university transport, on time',
  '01000000001', '01000000002', '01000000003',
  'T1-2026', 'الترم الأول 2026', 'Term 1 2026', current_date - 100, current_date + 12,
  'T2-2026', 'الترم الثاني 2026', 'Term 2 2026', current_date + 30, current_date + 150,
  true, 'ادفع كاش في مكتب الشركة أو إنستا باي أو فودافون كاش على الرقم 01000000002 واذكر الرقم المرجعي.',
  'Pay cash at the office, or by InstaPay / Vodafone Cash to 01000000002 and quote your reference.',
  'http://localhost:4173');

insert into public.universities (id, name_ar, name_en, city_ar, city_en) values
 (1, 'جامعة حورس', 'Horus University', 'دمياط الجديدة', 'New Damietta'),
 (2, 'جامعة الدلتا', 'Delta University', 'جمصة', 'Gamasa'),
 (3, 'جامعة المنصورة الجديدة', 'New Mansoura University', 'جمصة', 'Gamasa'),
 (4, 'جامعة المنصورة الأهلية', 'Mansoura National University', 'جمصة', 'Gamasa');
select setval('public.universities_id_seq', 4);

insert into public.slots (id, direction, depart_time) values
 (1,'to','07:00'),(2,'to','08:00'),(3,'to','10:00'),(4,'from','13:00'),(5,'from','14:00'),(6,'from','15:00'),(7,'from','16:00');
select setval('public.slots_id_seq', 7);

insert into public.routes (id, code, name_ar, name_en, university_id, term_price, duration_min) values
 (1,'MNS-HOR','المنصورة ← جامعة حورس','Mansoura → Horus University',1,9500,85),
 (2,'MNS-DEL','المنصورة ← جامعة الدلتا','Mansoura → Delta University',2,7500,55),
 (3,'MNS-NMU','المنصورة ← جامعة المنصورة الجديدة','Mansoura → New Mansoura University',3,8000,50),
 (4,'MNS-NAT','المنصورة ← جامعة المنصورة الأهلية','Mansoura → Mansoura National University',4,7800,52),
 (5,'MGH-NMU','ميت غمر ← جامعة المنصورة الجديدة','Mit Ghamr → New Mansoura University',3,8800,70);
select setval('public.routes_id_seq', 5);

insert into public.stops (id, route_id, seq, name_ar, name_en, offset_min, lat, lng) values
 (1,1,1,'ميدان المحطة','Station Square',0,31.040900,31.378500),
 (2,1,2,'توريل','Toril',8,31.074311,31.416209),
 (3,1,3,'حي الجامعة','University District',14,31.099794,31.444039),
 (4,1,4,'كوبري طلخا','Talkha Bridge',22,31.134338,31.480545),
 (5,1,5,'طلخا','Talkha',30,31.169529,31.516363),
 (6,1,6,'بوابة جامعة حورس','Horus University Gate',85,31.429000,31.744000),
 (7,2,1,'ميدان المحطة','Station Square',0,31.040900,31.378500),
 (8,2,2,'السلام','El Salam',7,31.094600,31.394408),
 (9,2,3,'المشاية','El Mashaya',13,31.140312,31.408891),
 (10,2,4,'شارع الجلاء','Galaa Street',20,31.193273,31.426779),
 (11,2,5,'الجمالية','El Gamaleya',32,31.283135,31.459922),
 (12,2,6,'ميت الخولي','Mit El Kholy',42,31.357127,31.489933),
 (13,2,7,'بوابة جامعة الدلتا','Delta University Gate',55,31.452100,31.532200),
 (14,3,1,'المنصورة - الحلواني','Helwany, Mansoura',0,31.040900,31.378500),
 (15,3,2,'توريل','Toril',8,31.103638,31.407728),
 (16,3,3,'جامعة المنصورة','Mansoura University',14,31.151018,31.428842),
 (17,3,4,'أجا','Aga',26,31.246622,31.468995),
 (18,3,5,'بلقاس','Belqas',37,31.335246,31.503371),
 (19,3,6,'بوابة جامعة المنصورة الجديدة','New Mansoura University Gate',50,31.441200,31.541000),
 (20,4,1,'ميدان المحطة','Station Square',0,31.040900,31.378500),
 (21,4,2,'سندوب','Sandub',9,31.112586,31.403918),
 (22,4,3,'طلخا','Talkha',20,31.199387,31.436967),
 (23,4,4,'دكرنس','Dekernes',31,31.285291,31.472194),
 (24,4,5,'المنزلة','El Manzala',42,31.370299,31.509602),
 (25,4,6,'بوابة الجامعة الأهلية','National University Gate',52,31.446800,31.545500),
 (26,5,1,'ميت غمر - الموقف','Mit Ghamr Terminal',0,30.715000,31.259000),
 (27,5,2,'زفتى','Zefta',10,30.815980,31.306400),
 (28,5,3,'السنبلاوين','El Senbellawein',22,30.938372,31.360149),
 (29,5,4,'المنصورة - الحلواني','Helwany, Mansoura',38,31.103624,31.426503),
 (30,5,5,'توريل','Toril',46,31.187134,31.457404),
 (31,5,6,'بوابة جامعة المنصورة الجديدة','New Mansoura University Gate',70,31.441200,31.541000);
select setval('public.stops_id_seq', 31);
