import { Nullable } from "../../types";
import { serialize } from "../../Misc/decorators";
import { EventState, Observer } from "../../Misc/observable";
import { Tools } from "../../Misc/tools";
import { TargetCamera } from "../../Cameras/targetCamera";
import { ICameraInput } from "../../Cameras/cameraInputsManager";
import { PointerInfo, PointerEventTypes, PointerTouch } from "../../Events/pointerEvents";

/**
 * Base class for Camera Pointer Inputs.
 * See FollowCameraPointersInput in src/Cameras/Inputs/followCameraPointersInput.ts
 * for example usage.
 */
export abstract class BaseCameraPointersInput implements ICameraInput<TargetCamera> {
    /**
     * Defines the camera the input is attached to.
     */
    abstract camera: TargetCamera;

    /**
     * The class name of the current input. Used by getClassName().
     */
    protected abstract _className: string;

    /**
     * Defines the buttons associated with the input to handle camera move.
     */
    @serialize()
    public buttons = [0, 1, 2];

    /**
     * Attach the input controls to a specific dom element to get the input from.
     * @param element Defines the element the controls should be listened from
     * @param noPreventDefault Defines whether event caught by the controls should call preventdefault() (https://developer.mozilla.org/en-US/docs/Web/API/Event/preventDefault)
     */
    public attachControl(element: HTMLElement, noPreventDefault?: boolean): void {
        var engine = this.camera.getEngine();
        var pointA: Nullable<PointerTouch> = null;
        var pointB: Nullable<PointerTouch> = null;
        var previousPinchSquaredDistance = 0;
        var previousMultiTouchPanPosition: Nullable<PointerTouch> = null;

        this._pointerInput = (p, s) => {
            var evt = <PointerEvent>p.event;
            let isTouch = (<any>p.event).pointerType === "touch";

            if (engine.isInVRExclusivePointerMode) {
                return;
            }

            if (p.type !== PointerEventTypes.POINTERMOVE &&
                this.buttons.indexOf(evt.button) === -1) {
                return;
            }

            let srcElement = <HTMLElement>(evt.srcElement || evt.target);

            if (engine.isPointerLock) {
                var offsetX = evt.movementX ||
                              evt.mozMovementX ||
                              evt.webkitMovementX ||
                              evt.msMovementX ||
                              0;
                var offsetY = evt.movementY ||
                              evt.mozMovementY ||
                              evt.webkitMovementY ||
                              evt.msMovementY ||
                              0;

                this.doTouch(null, offsetX, offsetY);
            } else if (p.type === PointerEventTypes.POINTERDOWN && srcElement) {
                try {
                    srcElement.setPointerCapture(evt.pointerId);
                } catch (e) {
                    //Nothing to do with the error. Execution will continue.
                }

                if (pointA === null) {
                    pointA = {x: evt.clientX,
                              y: evt.clientY,
                              pointerId: evt.pointerId,
                              type: evt.pointerType };
                } else if (pointB === null) {
                    pointB = {x: evt.clientX,
                              y: evt.clientY,
                              pointerId: evt.pointerId,
                              type: evt.pointerType };
                }

                if (!noPreventDefault) {
                    evt.preventDefault();
                    element.focus();
                }
            } else if (p.type === PointerEventTypes.POINTERDOUBLETAP) {
                this.doDoubleTouch(evt.pointerType);
            } else if (p.type === PointerEventTypes.POINTERUP && srcElement) {
                try {
                    srcElement.releasePointerCapture(evt.pointerId);
                } catch (e) {
                    //Nothing to do with the error.
                }

                if (!isTouch) {
                    pointB = null; // Mouse and pen are mono pointer
                }

                //would be better to use pointers.remove(evt.pointerId) for multitouch gestures,
                //but emptying completely pointers collection is required to fix a bug on iPhone :
                //when changing orientation while pinching camera,
                //one pointer stay pressed forever if we don't release all pointers
                //will be ok to put back pointers.remove(evt.pointerId); when iPhone bug corrected
                if (engine._badOS) {
                    pointA = pointB = null;
                } else {
                    //only remove the impacted pointer in case of multitouch allowing on most
                    //platforms switching from rotate to zoom and pan seamlessly.
                    if (pointB && pointA && pointA.pointerId == evt.pointerId) {
                        pointA = pointB;
                        pointB = null;
                    } else if (pointA && pointB && pointB.pointerId == evt.pointerId) {
                        pointB = null;
                    } else {
                        pointA = pointB = null;
                    }
                }

                if(previousPinchSquaredDistance !== 0 || previousMultiTouchPanPosition) {
                    this.doMultiTouch(
                      pointA,
                      pointB,
                      previousPinchSquaredDistance,
                      0,
                      previousMultiTouchPanPosition,
                      null);
                }
                previousPinchSquaredDistance = 0;
                previousMultiTouchPanPosition = null:

                if (!noPreventDefault) {
                    evt.preventDefault();
                }
            } else if (p.type === PointerEventTypes.POINTERMOVE) {
                if (!noPreventDefault) {
                    evt.preventDefault();
                }

                // One button down
                if (pointA && pointB === null) {
                    var offsetX = evt.clientX - pointA.x;
                    var offsetY = evt.clientY - pointA.y;
                    this.doTouch(pointA, offsetX, offsetY);

                    pointA.x = evt.clientX;
                    pointA.y = evt.clientY;
                }
                // Two buttons down: pinch
                else if (pointA && pointB) {
                    var ed = (pointA.pointerId === evt.pointerId) ? pointA : pointB;
                    ed.x = evt.clientX;
                    ed.y = evt.clientY;
                    var distX = pointA.x - pointB.x;
                    var distY = pointA.y - pointB.y;
                    var pinchSquaredDistance = (distX * distX) + (distY * distY);
                    var multiTouchPanPosition = {x: (pointA.x + pointB.x) / 2,
                                                 y: (pointA.y + pointB.y) / 2,
                                                 pointerId: evt.pointerId,
                                                 type: p.type};

                    this.doMultiTouch(
                      pointA,
                      pointB,
                      previousPinchSquaredDistance,
                      pinchSquaredDistance,
                      previousMultiTouchPanPosition,
                      multiTouchPanPosition);

                    previousMultiTouchPanPosition = multiTouchPanPosition;
                    previousPinchSquaredDistance = pinchSquaredDistance;
                }
            }
        };

        this._observer = this.camera.getScene().onPointerObservable.add(
            this._pointerInput,
            PointerEventTypes.POINTERDOWN | PointerEventTypes.POINTERUP |
            PointerEventTypes.POINTERMOVE);

        this._onLostFocus = () => {
            pointA = pointB = null;
        };

        element.addEventListener("contextmenu",
            <EventListener>this.onContextMenu.bind(this), false);

        Tools.RegisterTopRootEvents([
            { name: "blur", handler: this._onLostFocus }
        ]);
    }

    /**
     * Detach the current controls from the specified dom element.
     * @param element Defines the element to stop listening the inputs from
     */
    public detachControl(element: Nullable<HTMLElement>): void {
        if (this._onLostFocus) {
            Tools.UnregisterTopRootEvents([
                { name: "blur", handler: this._onLostFocus }
            ]);
        }

        if (element && this._observer) {
            this.camera.getScene().onPointerObservable.remove(this._observer);
            this._observer = null;

            if (this.onContextMenu) {
              element.removeEventListener("contextmenu", <EventListener>this.onContextMenu);
            }

            this._onLostFocus = null;
        }
    }

    /**
     * Gets the class name of the current input.
     * @returns the class name
     */
    public getClassName(): string {
        return this._className;
    }

    /**
     * Get the friendly name associated with the input class.
     * @returns the input friendly name
     */
    public getSimpleName(): string {
        return "pointers";
    }

    /**
     * Called on pointer POINTERDOUBLETAP event.
     * Override this method to provide functionality on POINTERDOUBLETAP event.
     */
    protected doDoubleTouch(type: string) {
    }

    /**
     * Called on pointer POINTERMOVE event if only a single touch is active.
     * Override this method to provide functionality.
     */
    protected doTouch(pointA: Nullable<PointerTouch>,
                      offsetX: number,
                      offsetY: number): void {
    }

    /**
     * Called on pointer POINTERMOVE event if multiple touches are active.
     * Override this method to provide functionality.
     */
    protected doMultiTouch(pointA: Nullable<PointerTouch>,
                           pointB: Nullable<PointerTouch>,
                           previousPinchSquaredDistance: number,
                           pinchSquaredDistance: number,
                           previousMultiTouchPanPosition: Nullable<PointerTouch>,
                           multiTouchPanPosition: Nullable<PointerTouch>): void {
        /* if (previousPinchSquaredDistance === 0 && previousMultiTouchPanPosition === null) {
         *     // First time this method is called when a user starts pinching.
         *     // pinchSquaredDistance and multiTouchPanPosition are valid.
         * }
         * if (pinchSquaredDistance === 0 && multiTouchPanPosition === null) {
         *     // Last time this method is called at the end of a pinch.
         *     // previousPinchSquaredDistance and previousMultiTouchPanPosition
         *     // are still valid.
         * }
         */
    }

    /**
     * Called on JS contextmenu event.
     * Override this method to provide functionality.
     */
    protected onContextMenu(evt: PointerEvent): void {
        evt.preventDefault();
    }

    private _pointerInput: (p: PointerInfo, s: EventState) => void;
    private _observer: Nullable<Observer<PointerInfo>>;
    private _onLostFocus: Nullable<(e: FocusEvent) => any>;
}
