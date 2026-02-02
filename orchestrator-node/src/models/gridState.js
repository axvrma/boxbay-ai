class GridState {
    constructor () {
        this.slots = this._initializeGrid();
    }

    _initializeGrid () {
        const slots = [];
        const grids = ['A', 'B'];
        const columns = 4; // Horizontal Stacks (X-Axis)
        const rows = 3;    // Vertical Tiers (Y-Axis)

        grids.forEach(grid => {
            for (let c = 1; c <= columns; c++) {
                for (let r = 1; r <= rows; r++) {
                    slots.push({
                        id: `Grid:${grid}-Col:${c}-Row:${r}`, // ID: Grid-Col(X)-Row(Y)
                        grid: grid,
                        column: c,
                        row: r,
                        status: 'available',
                        containerId: null,
                        expectedOutboundDate: null,
                        weight: null,
                        receiverId: null
                    });
                }
            }
        });
        return slots;
    }

    getAllSlots () {
        return this.slots;
    }

    getAvailableSlots () {
        return this.slots.filter(s => s.status === 'available');
    }

    occupySlot (slotId, containerId, outboundDate = null, weight = null, receiverId = null) {
        const slot = this.slots.find(s => s.id === slotId);
        if (slot && slot.status === 'available') {
            slot.status = 'occupied';
            slot.containerId = containerId;
            slot.expectedOutboundDate = outboundDate;
            slot.weight = weight;
            slot.receiverId = receiverId;
            return true;
        }
        return false;
    }

    releaseSlot (slotId) {
        const slot = this.slots.find(s => s.id === slotId);
        if (slot) {
            slot.status = 'available';
            slot.containerId = null;
            slot.expectedOutboundDate = null;
            slot.weight = null;
            slot.receiverId = null;
            return true;
        }
        return false;
    }

    resetGrid () {
        this.slots = this._initializeGrid();
    }
}

module.exports = new GridState();
