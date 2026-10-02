# BeerMap

Карты «Де купити» для пивоварен и медоварен. Один шаблон, много клиентов:
каждый клиент это папка в `clients/` с конфигом, картинками и ссылкой на Google-таблицу.
В браузере посетителя нет геокодинга: координаты готовятся при сборке, карта открывается сразу.

```
clients/<id>/client.json   конфиг: тексты, цвета, шрифт, маркер, страны маски, таблица, проект Cloudflare
clients/<id>/*.jpg|png     лого и иконка «Що поруч»
data/geocache.json         кеш координат (его коммитит CI)
data/cities.json           bbox городов (новые города CI добавляет сам, если город однозначный)
data/masks/*.geojson       контуры стран: Natural Earth (версия Украины, с Крымом), +3 км
template/                  разметка, стили и логика карты
build/                     сборка: таблица → координаты → dist/<id>/ → Cloudflare Pages
tests/                     unit (node:test) и e2e (Playwright), фикстуры
docs/demo/                 исходное демо «Нізащо Мила» для сравнения
```

## Как это работает

1. Раз в сутки (03:17 UTC), по кнопке или после изменений в `main` запускается
   workflow «Сборка и публикация карт».
2. Для каждого клиента скачивается CSV таблицы и проверяется: битые строки останавливают сборку с номером строки.
3. Координаты по приоритету:
   - `lat`/`lng` из таблицы (главнее всего, проверяются на попадание в город);
   - кеш `data/geocache.json` (ключ «город | улица | дом», поэтому геокодятся только новые и изменённые адреса);
   - Visicom → MapTiler → Nominatim, у каждого сначала `street`, потом `old_street`.
     Результат принимается, только если это адрес с номером дома, точка внутри bbox города
     и улица совпадает с нашей. «Центр города» и «центр улицы» отбрасываются.
4. Если адрес не найден, клиент не публикуется (на сайте остаётся прошлая версия), а в сводке
   запуска появляется таблица «проверь эти строки» со ссылками на поиск в OpenStreetMap.
   Исправь адрес или впиши координаты в `lat`/`lng`.
5. Найденные координаты коммитятся в репозиторий, страницы проверяются Playwright
   (390×844 и 1440×900, скриншоты лежат в артефактах запуска) и публикуются на Cloudflare Pages.

## Таблица

Колонки (первая строка): `name, type, city, street, house, old_street, instagram, gmaps_url, place_id, lat, lng, note, active`.

- `type`: `shop` или `bar` (можно `магазин`, `бар`, `паб`).
- `street` с типом: «вулиця Балківська», «Фонтанська дорога». `old_street`: прежнее название, если улицу переименовали.
- `house`: как на табличке: `87а`, `5-Б`, `16а/2`.
- `lat`/`lng`: необязательно, с точкой или запятой. Если заполнены, геокодер не используется.
- `gmaps_url` / `place_id`: только для кнопки «Прокласти маршрут». Координаты из Google на карту не берём.
- `active`: `FALSE` / `ні` / `0` скрывает точку, пусто = показывать.

Доступ: «Настройки доступа» → «Все, у кого есть ссылка» → «Читатель». В `sheetCsvUrl` тогда ставится
`https://docs.google.com/spreadsheets/d/<ID таблицы>/export?format=csv` (первый лист; для другого добавь `&gid=<номер листа из адресной строки>`).
Другой вариант: Файл → Поделиться → Опубликовать в интернете → лист → CSV, и вставить полученную ссылку.

## Новый клиент

1. Создай папку `clients/<id>/` (латиница, например `loca-deserta`).
2. Положи туда `client.json` (образец: `clients/nizashcho-myla/client.json`), `logo.jpg` и, если есть, иконку для «Що поруч».
3. Заполни тексты, цвета, `marker.text`, `countries`, `sheetCsvUrl`, `cloudflareProject`.
4. Закоммить в `main`. Проект Pages создастся сам при первой публикации.

Шаблон копировать не нужно. Новые страны для маски: `npm run masks -- POL` (код ISO3), затем закоммитить `data/masks/POL.geojson`.

## Секреты (GitHub → Settings → Secrets and variables → Actions)

| Имя | Где взять | Обязательно |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens → Create Token → Custom token → Permissions: *Account · Cloudflare Pages · Edit* | да |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Workers & Pages → справа «Account ID» | да |
| `VISICOM_API_KEY` | api.visicom.ua → регистрация → ключ Data API | желательно |
| `MAPTILER_API_KEY` | cloud.maptiler.com → Account → API keys | по желанию |

Без ключей работает только Nominatim (бесплатный, 1 запрос в секунду).
Во вкладке **Variables** можно задать `NOMINATIM_USER_AGENT` (например, `BeerMap/0.1 (you@example.com)`),
иначе используется ссылка на репозиторий.

## Локально

```
npm ci
npm test                                   # unit
npm run build -- nizashcho-myla --offline --csv tests/fixtures/nizashcho-myla.csv \
  --cache tests/fixtures/geocache.json --cities tests/fixtures/cities.json
npx playwright test                        # e2e по dist/
npm run serve                              # http://localhost:4173/nizashcho-myla/
```

`tests/fixtures/geocache.json` содержит **примерные** координаты только для тестов, на настоящую карту они не попадают.
