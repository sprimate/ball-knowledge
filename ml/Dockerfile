# Training image for ml/ (CPU PyTorch; the data is small enough that a run takes minutes).
# docker build -t bk-ml ml && docker run --rm -u 0 -v "$PWD/ml:/work" -w /work bk-ml python -u train.py ...
FROM python:3.12-slim
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir numpy pandas scikit-learn nba_api
