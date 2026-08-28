FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 PORT=8080

COPY pyproject.toml README.md ./
COPY src ./src
RUN pip install --no-cache-dir .

# No secrets in the image and none at runtime: the managed identity mints an Entra token.
USER nobody
EXPOSE 8080
CMD ["verifier", "serve"]
