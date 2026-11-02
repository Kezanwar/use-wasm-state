;; Self-contained fixture: no imports, covers the ordinary cases plus a
;; non-function export and a trapping function.
(module
  (memory (export "memory") 1)

  (func (export "add") (param i32 i32) (result i32)
    local.get 0
    local.get 1
    i32.add)

  (func $fib (export "fib") (param i32) (result i32)
    local.get 0
    i32.const 2
    i32.lt_s
    if (result i32)
      local.get 0
    else
      local.get 0
      i32.const 1
      i32.sub
      call $fib
      local.get 0
      i32.const 2
      i32.sub
      call $fib
      i32.add
    end)

  ;; Traps on call, so error propagation can be tested.
  (func (export "boom") (result i32)
    unreachable)
)
