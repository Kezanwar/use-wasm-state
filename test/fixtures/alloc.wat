;; An allocator module for the memory-helper tests.
;;
;; react-use-wasm tests these helpers against its committed memory.wasm,
;; built from examples/go/memory. use-wasm-state has no such module: its one
;; .wasm is the table engine, which has no business growing a `reverseString`
;; export just to satisfy a test. So the fixture is here instead, as .wat
;; like the others: reviewable, compiled by wabt at test time, no binary
;; committed and no TinyGo needed to run the suite.
;;
;; The exports are the same shapes the helpers have to get right -- an i32
;; array in, an f64 array out, a string mutated in place, an (offset, length)
;; pair packed into one i64 -- with the simplest body that proves each one.
(module
  (memory (export "memory") 1)

  ;; Bump pointer. Never reuses a block, which is fine for a test and keeps
  ;; `free` honest about being called without it hiding a double-free.
  (global $next (mut i32) (i32.const 1024))
  (global $inits (mut i32) (i32.const 0))

  (func (export "_initialize")
    (global.set $inits (i32.add (global.get $inits) (i32.const 1))))

  (func (export "initCount") (result i32)
    (global.get $inits))

  ;; 8-byte aligned so an f64 block is never misaligned, and grows memory
  ;; when it has to -- the helpers must survive that, since a grow detaches
  ;; every typed-array view taken before it.
  (func $alloc (export "alloc") (param $size i32) (result i32)
    (local $ptr i32) (local $end i32)
    (local.set $ptr (i32.and (i32.add (global.get $next) (i32.const 7)) (i32.const -8)))
    (local.set $end (i32.add (local.get $ptr) (local.get $size)))
    (if (i32.gt_u (local.get $end) (i32.mul (memory.size) (i32.const 65536)))
      (then
        (drop (memory.grow
          (i32.sub
            (i32.div_u (i32.add (local.get $end) (i32.const 65535)) (i32.const 65536))
            (memory.size))))))
    (global.set $next (local.get $end))
    (local.get $ptr))

  ;; A bump allocator has nothing to release. The tests count calls to it,
  ;; which is what they are actually checking.
  (func (export "free") (param $ptr i32))

  (func (export "sumInt32") (param $ptr i32) (param $len i32) (result i32)
    (local $i i32) (local $sum i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $sum
          (i32.add
            (local.get $sum)
            (i32.load (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 4))))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (local.get $sum))

  ;; Selection sort: swap on every inversion. O(n^2) and proud of it.
  (func (export "sortInt32") (param $ptr i32) (param $len i32)
    (local $i i32) (local $j i32) (local $pa i32) (local $pb i32) (local $a i32) (local $b i32)
    (block $outerDone
      (loop $outer
        (br_if $outerDone (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $j (i32.add (local.get $i) (i32.const 1)))
        (block $innerDone
          (loop $inner
            (br_if $innerDone (i32.ge_u (local.get $j) (local.get $len)))
            (local.set $pa (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 4))))
            (local.set $pb (i32.add (local.get $ptr) (i32.mul (local.get $j) (i32.const 4))))
            (local.set $a (i32.load (local.get $pa)))
            (local.set $b (i32.load (local.get $pb)))
            (if (i32.gt_s (local.get $a) (local.get $b))
              (then
                (i32.store (local.get $pa) (local.get $b))
                (i32.store (local.get $pb) (local.get $a))))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $inner)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $outer))))

  ;; ASCII only, which is the point: the test feeds it a string whose UTF-8
  ;; byte length differs from its character count, and the bytes outside
  ;; a-z have to come back untouched.
  (func (export "upperInPlace") (param $ptr i32) (param $len i32)
    (local $i i32) (local $at i32) (local $b i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $at (i32.add (local.get $ptr) (local.get $i)))
        (local.set $b (i32.load8_u (local.get $at)))
        (if (i32.and
              (i32.ge_u (local.get $b) (i32.const 97))
              (i32.le_u (local.get $b) (i32.const 122)))
          (then (i32.store8 (local.get $at) (i32.sub (local.get $b) (i32.const 32)))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next))))

  (func (export "scaleFloat64") (param $ptr i32) (param $len i32) (param $by f64)
    (local $i i32) (local $at i32)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (local.set $at (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 8))))
        (f64.store (local.get $at) (f64.mul (f64.load (local.get $at)) (local.get $by)))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next))))

  ;; (x, y) pairs in, mean written to out[0] and out[1]: the out-parameter
  ;; shape, where JS reserves the space and wasm fills it.
  (func (export "centroid") (param $ptr i32) (param $count i32) (param $out i32)
    (local $i i32) (local $at i32) (local $sx f64) (local $sy f64) (local $n f64)
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $count)))
        (local.set $at (i32.add (local.get $ptr) (i32.mul (local.get $i) (i32.const 16))))
        (local.set $sx (f64.add (local.get $sx) (f64.load (local.get $at))))
        (local.set $sy (f64.add (local.get $sy) (f64.load offset=8 (local.get $at))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (local.set $n (f64.convert_i32_u (local.get $count)))
    (f64.store (local.get $out) (f64.div (local.get $sx) (local.get $n)))
    (f64.store offset=8 (local.get $out) (f64.div (local.get $sy) (local.get $n))))

  ;; Allocates its own result and hands back (offset << 32) | length, which
  ;; the caller is then responsible for freeing. stringVal/bytesVal do both.
  (func $reverseString (export "reverseString") (param $ptr i32) (param $len i32) (result i64)
    (local $out i32) (local $i i32)
    (local.set $out (call $alloc (local.get $len)))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $i) (local.get $len)))
        (i32.store8
          (i32.add (local.get $out) (local.get $i))
          (i32.load8_u
            (i32.sub
              (i32.add (local.get $ptr) (i32.sub (local.get $len) (i32.const 1)))
              (local.get $i))))
        (local.set $i (i32.add (local.get $i) (i32.const 1)))
        (br $next)))
    (i64.or
      (i64.shl (i64.extend_i32_u (local.get $out)) (i64.const 32))
      (i64.extend_i32_u (local.get $len))))

  ;; Returns 0 for input it can't handle, which is the convention the packed
  ;; helpers read as "no value" rather than "a string at offset 0".
  (func (export "statsOrZero") (param $ptr i32) (param $len i32) (result i64)
    (if (i32.or
          (i32.eqz (local.get $len))
          (i32.ne (i32.load8_u (local.get $ptr)) (i32.const 123))) ;; '{'
      (then (return (i64.const 0))))
    (call $reverseString (local.get $ptr) (local.get $len)))
)
