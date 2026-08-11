# Base image ships Chromium + all system deps, matched to playwright 1.55.0.
FROM mcr.microsoft.com/playwright/python:v1.55.0-noble

WORKDIR /app

# Install Python deps first (better layer caching).
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && playwright install chromium

# App code (sessions/ config/ logs/ are mounted as volumes at runtime).
COPY . .

ENV PYTHONUNBUFFERED=1
EXPOSE 5000

# SINGLE worker on purpose: the service keeps job state + dealer-login sessions
# in memory, so it must not be replicated across workers. Threads give
# concurrency within the one process. Long timeout for slow AJAX order flows.
CMD ["gunicorn", "-w", "1", "-k", "gthread", "--threads", "8", \
     "--timeout", "600", "-b", "0.0.0.0:5000", "api_server:app"]
