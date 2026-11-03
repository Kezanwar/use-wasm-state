;; Needs env.log, so instantiating without it must fail.
(module
  (import "env" "log" (func $log (param i32)))

  (func (export "logSum") (param i32 i32) (result i32) (local i32)
    local.get 0
    local.get 1
    i32.add
    local.set 2
    local.get 2
    call $log
    local.get 2)
)
