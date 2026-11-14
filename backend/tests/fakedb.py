"""Tiny in-memory stand-in for the Supabase client: just the query methods the app uses."""
import uuid
from types import SimpleNamespace


class _Q:
    def __init__(self, db, name):
        self.db, self.name = db, name
        self.filters, self.order_col, self.rng, self.op, self.payload, self.want_count = [], None, None, "select", None, False

    # builders
    def select(self, cols="*", count=None): self.op, self.want_count = "select", bool(count); return self
    def insert(self, rows): self.op, self.payload = "insert", rows; return self
    def update(self, fields): self.op, self.payload = "update", fields; return self
    def delete(self): self.op = "delete"; return self
    def eq(self, k, v): self.filters.append((k, "eq", v)); return self
    def neq(self, k, v): self.filters.append((k, "neq", v)); return self
    def gte(self, k, v): self.filters.append((k, "gte", v)); return self
    def lt(self, k, v): self.filters.append((k, "lt", v)); return self
    def order(self, col, desc=False): self.order_col = col; return self
    def range(self, a, b): self.rng = (a, b); return self
    def limit(self, n): self.rng = (0, n - 1); return self

    def _match(self, row):
        for k, op, v in self.filters:
            x = row.get(k)
            if x is None:                      # SQL: comparisons with NULL are never true
                return False
            x, v = str(x) if op in ("gte", "lt") else x, str(v) if op in ("gte", "lt") else v
            if op == "eq" and x != v: return False
            if op == "neq" and x == v: return False
            if op == "gte" and not x >= v: return False
            if op == "lt" and not x < v: return False
        return True

    def execute(self):
        rows = self.db.tables.setdefault(self.name, [])
        if self.op == "insert":
            new = [dict(r) for r in (self.payload if isinstance(self.payload, list) else [self.payload])]
            for r in new: r.setdefault("id", str(uuid.uuid4()))
            rows.extend(new)
            return SimpleNamespace(data=new, count=len(new))
        hit = [r for r in rows if self._match(r)]
        if self.op == "update":
            for r in hit: r.update(self.payload)
            return SimpleNamespace(data=[dict(r) for r in hit], count=len(hit))
        if self.op == "delete":
            for r in hit: rows.remove(r)
            return SimpleNamespace(data=hit, count=len(hit))
        if self.order_col: hit = sorted(hit, key=lambda r: str(r.get(self.order_col)))
        total = len(hit)
        if self.rng: hit = hit[self.rng[0]: self.rng[1] + 1]
        return SimpleNamespace(data=[dict(r) for r in hit], count=total if self.want_count else None)


class FakeDB:
    def __init__(self):
        self.tables = {}

    def table(self, name): return _Q(self, name)
    def rpc(self, *a, **k): raise RuntimeError("rpc not available in the fake")   # forces the paged fallback
