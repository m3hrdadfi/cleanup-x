from sqlalchemy import select

from .models import Classification, InventoryRemoval, Scan


def visible_scans():
    return Scan.id.not_in(
        select(InventoryRemoval.scan_id).where(InventoryRemoval.post_id.is_(None))
    )


def visible_results():
    # Correlate to each result's session so removing an item never affects another session.
    return ~select(InventoryRemoval.id).where(
        InventoryRemoval.scan_id == Classification.scan_id,
        (InventoryRemoval.post_id.is_(None))
        | (InventoryRemoval.post_id == Classification.post_id),
    ).exists()
