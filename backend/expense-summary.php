<?php
declare(strict_types=1);

namespace AgentTT;

/**
 * Split each expense into integer TWD shares. When division has a remainder,
 * the first participant IDs in strcmp order receive one additional dollar.
 * No database or session state is read or changed by this calculation.
 */
function calculateExpenseSummary(array $trip, array $expenses): array
{
    $budget = $trip['budget'] ?? null;
    $members = $trip['members'] ?? null;
    if (!is_int($budget) || $budget < 0 || $budget > 1000000000) {
        throw new \InvalidArgumentException('Trip budget must be an integer from 0 to 1,000,000,000.');
    }
    if (!is_array($members) || !array_is_list($members) || $members === []) {
        throw new \InvalidArgumentException('Trip members must be a nonempty list.');
    }
    if (!array_is_list($expenses)) {
        throw new \InvalidArgumentException('Expenses must be a list.');
    }

    // Prefix map keys so numeric-looking user IDs remain distinct strings.
    $balancesById = [];
    foreach ($members as $member) {
        if (!is_array($member)
            || !is_string($member['userId'] ?? null) || $member['userId'] === ''
            || !is_string($member['name'] ?? null)) {
            throw new \InvalidArgumentException('Each trip member must have a user ID and name.');
        }
        $key = 'user:' . $member['userId'];
        if (isset($balancesById[$key])) {
            throw new \InvalidArgumentException('Trip member IDs must be unique.');
        }
        $balancesById[$key] = [
            'userId' => $member['userId'], 'name' => $member['name'],
            'paid' => 0, 'share' => 0, 'balance' => 0,
        ];
    }

    $categories = ['transport', 'accommodation', 'food', 'activity', 'other'];
    $categoryTotals = array_fill_keys($categories, 0);
    $totalSpent = 0;
    $add = static function (int $total, int $amount): int {
        if ($amount > PHP_INT_MAX - $total) {
            throw new \OverflowException('Expense totals exceed the integer range.');
        }
        return $total + $amount;
    };

    foreach ($expenses as $expense) {
        if (!is_array($expense)) {
            throw new \InvalidArgumentException('Each expense must be an array.');
        }
        $amount = $expense['amount'] ?? null;
        $payerId = $expense['payerId'] ?? null;
        $participantIds = $expense['participantIds'] ?? null;
        $category = $expense['category'] ?? null;
        if (!is_int($amount) || $amount < 1 || $amount > 1000000000) {
            throw new \InvalidArgumentException('Expense amount must be an integer from 1 to 1,000,000,000.');
        }
        if (!is_string($payerId) || !isset($balancesById['user:' . $payerId])) {
            throw new \InvalidArgumentException('The expense payer must be a trip member.');
        }
        if (!is_array($participantIds) || !array_is_list($participantIds) || $participantIds === []) {
            throw new \InvalidArgumentException('Expense participants must be a nonempty list.');
        }
        if (!is_string($category) || !array_key_exists($category, $categoryTotals)) {
            throw new \InvalidArgumentException('Expense category is invalid.');
        }
        $seenParticipants = [];
        foreach ($participantIds as $participantId) {
            if (!is_string($participantId) || !isset($balancesById['user:' . $participantId])) {
                throw new \InvalidArgumentException('Each expense participant must be a trip member.');
            }
            $key = 'user:' . $participantId;
            if (isset($seenParticipants[$key])) {
                throw new \InvalidArgumentException('Expense participant IDs must be unique.');
            }
            $seenParticipants[$key] = true;
        }
        usort($participantIds, 'strcmp');

        $totalSpent = $add($totalSpent, $amount);
        $categoryTotals[$category] = $add($categoryTotals[$category], $amount);
        $payerKey = 'user:' . $payerId;
        $balancesById[$payerKey]['paid'] = $add($balancesById[$payerKey]['paid'], $amount);
        $participantCount = count($participantIds);
        $share = intdiv($amount, $participantCount);
        $remainder = $amount % $participantCount;
        foreach ($participantIds as $index => $participantId) {
            $key = 'user:' . $participantId;
            $participantShare = $share + ($index < $remainder ? 1 : 0);
            $balancesById[$key]['share'] = $add($balancesById[$key]['share'], $participantShare);
        }
    }

    $balances = array_values($balancesById);
    usort($balances, static fn (array $a, array $b): int => strcmp($a['userId'], $b['userId']));
    $debtors = [];
    $creditors = [];
    foreach ($balances as &$member) {
        // Both operands are nonnegative and at most PHP_INT_MAX, so their
        // difference cannot overflow or become PHP_INT_MIN.
        $member['balance'] = $member['paid'] - $member['share'];
        if ($member['balance'] < 0) {
            $debtors[] = ['userId' => $member['userId'], 'amount' => -$member['balance']];
        } elseif ($member['balance'] > 0) {
            $creditors[] = ['userId' => $member['userId'], 'amount' => $member['balance']];
        }
    }
    unset($member);

    $settlements = [];
    $debtorIndex = 0;
    $creditorIndex = 0;
    while ($debtorIndex < count($debtors) && $creditorIndex < count($creditors)) {
        $amount = min($debtors[$debtorIndex]['amount'], $creditors[$creditorIndex]['amount']);
        $settlements[] = [
            'fromUserId' => $debtors[$debtorIndex]['userId'],
            'toUserId' => $creditors[$creditorIndex]['userId'], 'amount' => $amount,
        ];
        $debtors[$debtorIndex]['amount'] -= $amount;
        $creditors[$creditorIndex]['amount'] -= $amount;
        if ($debtors[$debtorIndex]['amount'] === 0) {
            $debtorIndex++;
        }
        if ($creditors[$creditorIndex]['amount'] === 0) {
            $creditorIndex++;
        }
    }
    if ($debtorIndex !== count($debtors) || $creditorIndex !== count($creditors)) {
        throw new \LogicException('Expense balances do not conserve money.');
    }

    $byCategory = [];
    foreach ($categories as $category) {
        $byCategory[] = ['category' => $category, 'amount' => $categoryTotals[$category]];
    }
    return [
        'totalSpent' => $totalSpent, 'budget' => $budget,
        'remaining' => $budget - $totalSpent, 'overBudget' => $totalSpent > $budget,
        'byCategory' => $byCategory, 'balances' => $balances, 'settlements' => $settlements,
    ];
}
