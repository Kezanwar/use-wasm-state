;; A module that owns memory, for the loader's per-instance test.
;;
;; The loader compiles a module once and instantiates it many times, and the
;; claim is that each instance gets its own linear memory. A bump allocator
;; proves it: two instances sharing memory could not both hand back the same
;; first offset.
(module
  (memory (export "memory") 1)

  ;; One page, never reused, and no grow: the test asks for sixteen bytes.
  ;; 8-byte aligned, so an f64 block is never misaligned.
  (global $next (mut i32) (i32.const 1024))

  (func (export "alloc") (param $size i32) (result i32)
    (local $ptr i32)
    (local.set $ptr (i32.and (i32.add (global.get $next) (i32.const 7)) (i32.const -8)))
    (global.set $next (i32.add (local.get $ptr) (local.get $size)))
    (local.get $ptr))
)
