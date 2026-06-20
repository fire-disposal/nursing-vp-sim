from infrastructure.rag.indexer import index_all, check_indexed
print(f"Before: {check_indexed()} chunks")
n = index_all(force=True)
print(f"After: {check_indexed()} chunks, newly indexed: {n}")
