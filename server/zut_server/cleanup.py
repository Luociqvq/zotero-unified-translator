from .config import Settings
from .worker import cleanup_expired


def main() -> None:
    removed = cleanup_expired(Settings.from_env())
    print(f"removed {removed} expired task(s)")


if __name__ == "__main__":
    main()
