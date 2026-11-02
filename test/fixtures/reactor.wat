;; WASI "reactor" shape. _initialize must run exactly once before anything
;; else; initCount proves how many times it actually ran.
(module
  (global $inits (mut i32) (i32.const 0))

  (func (export "_initialize")
    global.get $inits
    i32.const 1
    i32.add
    global.set $inits)

  (func (export "initCount") (result i32)
    global.get $inits)
)
