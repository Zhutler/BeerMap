# BeerMap

Карты «Де купити» для пивоварен и медоварен. Один шаблон, много клиентов:
каждый клиент это папка в `clients/` с конфигом, картинками и ссылкой на Google-таблицу.

```
clients/<id>/client.json   конфиг: тексты, цвета, шрифт, маркер, страны маски, таблица
clients/<id>/*.jpg|png     лого и иконка «Що поруч»
data/geocache.json         кеш координат (коммитит CI)
data/cities.json           bbox городов
data/masks/*.geojson       контуры стран (Natural Earth, версия Украины, +3 км)
template/                  разметка, стили и логика карты (без геокодинга)
build/                     сборка: таблица → координаты → dist/<id>/
tests/                     unit (node:test) и e2e (Playwright)
docs/demo/                 исходное демо «Нізащо Мила» для сравнения
```

Подробная инструкция появится на шаге с GitHub Actions и Cloudflare Pages.
