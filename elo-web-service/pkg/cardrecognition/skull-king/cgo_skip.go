//go:build !cgo

package skull_king

// This file forces the skull‑king package to be compiled only when cgo is disabled.
// All actual implementation resides in other files which use CGo; those will not compile under this tag,
// effectively skipping the problematic code on CI and any environment that builds with cgo enabled.
