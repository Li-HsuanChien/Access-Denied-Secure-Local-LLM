# Library frontend

`LibraryView` and `LibraryClient` implement local PDF selection, per-file validation review, explicit confirmation of the accepted remainder, cancellable publication progress, version listing, and rollback. The client calls the versioned host contract; it never mutates an index. See the [Collection Library design](../../../../../../../docs/architecture/SDD.md#41-collection-library).
