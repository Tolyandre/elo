# Its a Wonderful World — Card Recognition

Распознаёт нижние полоски карт, жетоны и планшет империи на фото стола для автоматического заполнения формы скоринга.

## Стек

- **YOLO26 OBB** — детекция повёрнутых объектов (карты под углом, жетоны, планшет)
- **OpenCV template matching** — распознавание типа карты и коэффициентов
- **FastAPI** — HTTP-сервис для Go backend

## Быстрый старт (NixOS)

```bash
# Создать окружение (один раз)
nix develop
python -m venv recognition/.venv
source recognition/.venv/bin/activate
pip install -r recognition/its-a-wonderful-world/requirements.txt

# При каждом входе
nix develop && source recognition/.venv/bin/activate
```

## Подготовка данных

```bash
cd recognition/its-a-wonderful-world

# 1. Нарезать спрайтшит на полоски карт
python scripts/parse_spritesheet.py --cols 9 --rows 8 --show

# 2. Вручную заполнить data/card_database.json
#    (открыть data/card_strips/ и заполнить тип и скоринг для каждой карты)
cp data/card_database_template.json data/card_database.json
# ... редактировать card_database.json ...

# 3. Добавить фото деревянного стола в data/backgrounds/ (опционально)

# 4. Сгенерировать синтетический датасет
python scripts/generate_dataset.py --count 6000
```

## Обучение

```bash
# Обучение на синтетических данных
python scripts/train.py --epochs 100 --device cpu

# Fine-tuning на реальных фото (после разметки, см. LABELING.md)
python scripts/train.py --fine-tune runs/iaww_v1/weights/best.pt --epochs 30 --name iaww_v2

# Скопировать лучшую модель
cp runs/iaww_v1/weights/best.pt model/best.pt
cp runs/iaww_v1/weights/best.onnx model/best.onnx
```

## Тестирование

```bash
python scripts/test_inference.py --image samples/1.jpg
```

## Запуск сервиса

```bash
uvicorn service:app --port 8765
# → POST http://localhost:8765/recognize  (multipart file)
```

## Разметка новых фото

См. [LABELING.md](LABELING.md).

## Структура файлов

```
its-a-wonderful-world/
├── README.md
├── LABELING.md           # инструкция по разметке
├── requirements.txt
├── service.py            # FastAPI endpoint
├── cards-1652.webp       # спрайтшит всех карт
├── empires.webp          # планшеты империй
├── tokens.webp           # жетоны
├── samples/              # реальные фото для тестирования
├── scripts/
│   ├── parse_spritesheet.py  # нарезка спрайтшита
│   ├── generate_dataset.py   # синтетический датасет
│   ├── train.py              # обучение YOLO26
│   └── test_inference.py     # тест + визуализация
├── templates/
│   ├── icons/            # вырезанные иконки типов карт (structure.png, …)
│   └── digits/           # шаблоны цифр 1–12
├── data/
│   ├── card_database.json       # метаданные карт (заполнить вручную)
│   ├── card_database_template.json  # генерируется parse_spritesheet.py
│   ├── card_strips/             # нарезанные полоски
│   ├── empire_strips/           # полоски планшетов
│   ├── backgrounds/             # фото стола (добавить вручную)
│   └── dataset/                 # YOLO train/val/test
├── model/
│   ├── best.pt           # обученные веса PyTorch
│   └── best.onnx         # экспорт для CPU inference (38.9ms)
└── runs/                 # артефакты обучения
```
