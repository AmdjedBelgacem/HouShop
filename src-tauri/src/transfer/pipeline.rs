use super::normalizer::stream_copy_atomic;
use super::types::TransferCategory;
use std::fs;
use std::path::{Path, PathBuf};

pub struct StagingPipeline {
    session_uuid: String,
    session_dir: PathBuf,
}

impl StagingPipeline {
    pub fn new(base_transfers_dir: &Path, session_uuid: &str) -> Result<Self, String> {
        let session_dir = base_transfers_dir.join("temp").join(session_uuid);
        fs::create_dir_all(&session_dir)
            .map_err(|e| format!("Failed to create staging directory: {}", e))?;

        // Initialize category subdirectories
        for cat in TransferCategory::all() {
            let cat_dir = session_dir.join(cat.as_str());
            let _ = fs::create_dir_all(&cat_dir);
        }

        Ok(Self {
            session_uuid: session_uuid.to_string(),
            session_dir,
        })
    }

    pub fn session_dir(&self) -> &Path {
        &self.session_dir
    }

    pub fn category_dir(&self, category: TransferCategory) -> PathBuf {
        self.session_dir.join(category.as_str())
    }

    /// Stages a file into the session scratchpad with streaming chunk copy and SHA-256 calculation.
    pub fn stage_file<F>(
        &self,
        category: TransferCategory,
        filename: &str,
        source_path: &Path,
        on_chunk: F,
    ) -> Result<(PathBuf, u64, String, bool), String>
    where
        F: FnMut(u64, u64),
    {
        let target_path = self.category_dir(category).join(filename);
        let (transferred, hash, deduplicated) = stream_copy_atomic(source_path, &target_path, on_chunk)?;
        Ok((target_path, transferred, hash, deduplicated))
    }

    /// Cleans up any remaining `.partial` temporary files left behind by interrupted writes.
    pub fn cleanup_partial_files(&self) {
        let _ = cleanup_partials_recursive(&self.session_dir);
    }

    /// Moves the staged session directory into a permanent `completed/<uuid>`
    /// archive instead of deleting it. Used when the migrated bundle lives on
    /// the desktop side (virtual / iOS destinations).
    pub fn archive(&self) {
        let archive_dir = self
            .session_dir
            .parent()
            .and_then(|temp| temp.parent())
            .map(|base| base.join("completed").join(&self.session_uuid));
        if let Some(dest) = archive_dir {
            if let Some(parent) = dest.parent() {
                let _ = fs::create_dir_all(parent);
            }
            if dest.exists() {
                let _ = fs::remove_dir_all(&dest);
            }
            let _ = fs::rename(&self.session_dir, &dest);
        }
    }

    /// Purges the entire session staging scratch directory.
    pub fn purge(self) {
        let _ = fs::remove_dir_all(&self.session_dir);
    }
}

fn cleanup_partials_recursive(dir: &Path) -> std::io::Result<()> {
    if !dir.is_dir() {
        return Ok(());
    }

    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            let _ = cleanup_partials_recursive(&path);
        } else if let Some(ext) = path.extension() {
            if ext == "partial" {
                let _ = fs::remove_file(&path);
            }
        }
    }

    Ok(())
}
