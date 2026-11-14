import torch
import torch.nn as nn
import numpy as np
from pathlib import Path

MODEL_DIR = Path("ml_models/lstm")
MODEL_DIR.mkdir(parents=True, exist_ok=True)


class StressLSTM(nn.Module):
    def __init__(self, input_size=11, hidden1=128, hidden2=64, output_size=3, dropout=0.3):
        super().__init__()
        self.lstm1 = nn.LSTM(input_size, hidden1, batch_first=True)
        self.drop1 = nn.Dropout(dropout)
        self.lstm2 = nn.LSTM(hidden1, hidden2, batch_first=True)
        self.drop2 = nn.Dropout(dropout)
        self.fc = nn.Linear(hidden2, output_size)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x):
        out, _ = self.lstm1(x)
        out = self.drop1(out)
        out, _ = self.lstm2(out)
        out = self.drop2(out[:, -1, :])
        return self.sigmoid(self.fc(out))


def fit_model(sequences: np.ndarray, labels: np.ndarray, epochs: int = 50, seed: int | None = None):
    """
    Train a fresh StressLSTM and return (model, final_epoch_loss). Does not touch the disk.
    sequences: (N, 14, 11); labels: (N, 3) risk in [0, 1].
    """
    if seed is not None:
        torch.manual_seed(seed)
    model = StressLSTM()
    optimizer = torch.optim.Adam(model.parameters(), lr=1e-3)
    criterion = nn.BCELoss()

    X = torch.tensor(sequences, dtype=torch.float32)
    y = torch.tensor(labels, dtype=torch.float32)

    dataset = torch.utils.data.TensorDataset(X, y)
    loader = torch.utils.data.DataLoader(dataset, batch_size=16, shuffle=True)

    model.train()
    avg = float("nan")
    for epoch in range(epochs):
        total_loss = 0.0
        for xb, yb in loader:
            optimizer.zero_grad()
            pred = model(xb)
            loss = criterion(pred, yb)
            loss.backward()
            optimizer.step()
            total_loss += loss.item()
        avg = total_loss / len(loader)
        if (epoch + 1) % 10 == 0:
            print(f"  epoch {epoch+1}/{epochs}  loss={avg:.4f}")
    model.eval()
    return model, avg


def train_user_lstm(uid: str, sequences: np.ndarray, labels: np.ndarray, epochs: int = 50):
    """
    sequences: (N, 14, 11)  — N samples of 14-day windows
    labels:    (N, 3)       — risk probabilities for next 3 days
    Saves directly to ml_models/lstm/<uid>.pt (used by scripts/seed_test_account.py).
    The automatic pipeline (app/services/lstm_training.py) uses fit_model + an atomic save instead.
    """
    model, _ = fit_model(sequences, labels, epochs)
    torch.save(model.state_dict(), str(MODEL_DIR / f"{uid}.pt"))
    print(f"LSTM saved for user {uid}")
    return model
