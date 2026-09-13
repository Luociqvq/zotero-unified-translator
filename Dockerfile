FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV PYTHONPATH=/app/server

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 libgl1 fonts-noto-cjk

COPY server/requirements.txt /app/server/requirements.txt
RUN python -m pip install --no-cache-dir -r /app/server/requirements.txt

COPY server /app/server

RUN mkdir -p /app/data

EXPOSE 8890

CMD ["python", "-m", "zut_server"]
